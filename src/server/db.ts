import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, BatchWriteCommand, DeleteCommand, UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

export const TABLE = process.env.TABLE_NAME ?? 'bwyd-lleol';

const endpoint = process.env.DYNAMODB_ENDPOINT; // set for local dev, e.g. http://localhost:8000
const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'eu-west-2',
  ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
});
export const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

export async function ensureTable(): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE }));
    return;
  } catch {
    /* create below */
  }
  await client.send(new CreateTableCommand({
    TableName: TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
  }));
}

/**
 * A demo session's slice of the table. Every key is prefixed with the session
 * id, so several role-play sessions can share one table and reset independently.
 */
export function session(id: string) {
  const P = (kind: string) => `${id}#${kind}`;
  return {
    id,
    async put(kind: string, sk: string, data: object) {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: P(kind), sk, ...data } }));
    },
    async get<T>(kind: string, sk: string): Promise<T | undefined> {
      const r = await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: P(kind), sk } }));
      return stripKeys<T>(r.Item);
    },
    async list<T>(kind: string, skPrefix?: string): Promise<T[]> {
      const items: T[] = [];
      let key: Record<string, unknown> | undefined;
      do {
        const r = await doc.send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
          ExpressionAttributeValues: skPrefix ? { ':pk': P(kind), ':sk': skPrefix } : { ':pk': P(kind) },
          ExclusiveStartKey: key,
        }));
        for (const it of r.Items ?? []) items.push(stripKeys<T>(it)!);
        key = r.LastEvaluatedKey;
      } while (key);
      return items;
    },
    /** Write only if absent (or past its `expires` epoch-ms); returns whether this caller won. */
    async putIfAbsent(kind: string, sk: string, data: { expires: number } & object): Promise<boolean> {
      try {
        await doc.send(new PutCommand({
          TableName: TABLE,
          Item: { pk: P(kind), sk, ...data },
          ConditionExpression: 'attribute_not_exists(pk) OR expires < :now',
          ExpressionAttributeValues: { ':now': Date.now() },
        }));
        return true;
      } catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    /** Create an item only if it doesn't exist; returns false if it already did. */
    async create(kind: string, sk: string, data: object): Promise<boolean> {
      return condOk(() => doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: P(kind), sk, ...data }, ConditionExpression: 'attribute_not_exists(pk)',
      })));
    },
    /** SET fields on an existing item if `condition` holds (attribute names as #name, values as :value). */
    async updateIf(kind: string, sk: string, set: Record<string, unknown>, condition = 'attribute_exists(pk)',
      values: Record<string, unknown> = {}): Promise<boolean> {
      const keys = Object.keys(set);
      return condOk(() => doc.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: P(kind), sk },
        UpdateExpression: 'SET ' + keys.map((k) => `#s_${k} = :s_${k}`).join(', '),
        ConditionExpression: condition,
        ExpressionAttributeNames: {
          ...Object.fromEntries(keys.map((k) => [`#s_${k}`, k])),
          ...Object.fromEntries([...condition.matchAll(/#(\w+)/g)].map((m) => [`#${m[1]}`, m[1]])),
        },
        ExpressionAttributeValues: { ...Object.fromEntries(keys.map((k) => [`:s_${k}`, set[k]])), ...values },
      })));
    },
    /** Atomically increment a counter and return the new value. */
    async nextSeq(kind: string, sk: string): Promise<number> {
      const r = await doc.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: P(kind), sk }, UpdateExpression: 'ADD #n :one',
        ExpressionAttributeNames: { '#n': 'n' }, ExpressionAttributeValues: { ':one': 1 }, ReturnValues: 'UPDATED_NEW',
      }));
      return r.Attributes!.n as number;
    },
    /** Building blocks for `transact`: all-or-nothing writes across several items. */
    tPut(kind: string, sk: string, data: object, condition?: string, names?: Record<string, string>, values?: Record<string, unknown>): TxItem {
      return { Put: { TableName: TABLE, Item: { pk: P(kind), sk, ...data }, ConditionExpression: condition,
        ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    },
    tUpdate(kind: string, sk: string, update: string, names: Record<string, string>, values: Record<string, unknown>, condition?: string): TxItem {
      return { Update: { TableName: TABLE, Key: { pk: P(kind), sk }, UpdateExpression: update, ConditionExpression: condition,
        ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    },
    /** Returns ok, or the index of the first item whose condition failed (-1 if it failed for another reason). */
    async transact(items: TxItem[]): Promise<{ ok: true } | { ok: false; failedIndex: number }> {
      try {
        await doc.send(new TransactWriteCommand({ TransactItems: items as never }));
        return { ok: true };
      } catch (e) {
        if ((e as Error).name === 'TransactionCanceledException') {
          const reasons = (e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
          return { ok: false, failedIndex: reasons.findIndex((r) => r.Code === 'ConditionalCheckFailed') };
        }
        throw e;
      }
    },
    /** Delete an item if `condition` holds; returns whether it was deleted. */
    async removeIf(kind: string, sk: string, condition: string, names: Record<string, string>, values: Record<string, unknown>) {
      return condOk(() => doc.send(new DeleteCommand({
        TableName: TABLE, Key: { pk: P(kind), sk }, ConditionExpression: condition,
        ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      })));
    },
    async remove(kind: string, sk: string) {
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: P(kind), sk } }));
    },
    /** Delete every item of the given kinds in this session. */
    async clear(kinds: string[]) {
      for (const kind of kinds) {
        const r = await doc.send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': P(kind) },
          ProjectionExpression: 'pk, sk',
        }));
        await batch((r.Items ?? []).map((i) => ({ DeleteRequest: { Key: { pk: i.pk, sk: i.sk } } })));
        if (r.LastEvaluatedKey) await this.clear([kind]);
      }
    },
    async putMany(kind: string, rows: { sk: string; data: object }[]) {
      await batch(rows.map((r) => ({ PutRequest: { Item: { pk: P(kind), sk: r.sk, ...r.data } } })));
    },
  };
}
export type Session = ReturnType<typeof session>;
export type TxItem = Record<string, unknown>;

async function condOk(f: () => Promise<unknown>): Promise<boolean> {
  try {
    await f();
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

async function batch(requests: object[]) {
  for (let i = 0; i < requests.length; i += 25) {
    let pending: object[] = requests.slice(i, i + 25);
    for (let attempt = 0; pending.length && attempt < 6; attempt++) {
      const r = await doc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: pending as never } }));
      pending = (r.UnprocessedItems?.[TABLE] as object[] | undefined) ?? [];
      if (pending.length) await new Promise((res) => setTimeout(res, 50 * 2 ** attempt));
    }
  }
}

function stripKeys<T>(item: Record<string, unknown> | undefined): T | undefined {
  if (!item) return undefined;
  const { pk: _pk, sk: _sk, ...rest } = item;
  return rest as T;
}
