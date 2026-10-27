import '../src/server/env-local';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildLambda } from '../scripts/build-lambda';
import { plannedResources, throttleDefault } from '../scripts/deploy';
import { artifactBucketName, cacheControlFor, codeKey, contentTypeFor, parameterOverrides, parseArgs, stackName } from '../scripts/lib';
import { ensureTable } from '../src/server/db';

const root = resolve(__dirname, '..');
type Resource = { Type: string; Condition?: string; DeletionPolicy?: string; Properties: Record<string, any> };
const doc = YAML.parse(readFileSync(join(root, 'infra', 'template.yaml'), 'utf8')) as {
  Parameters: Record<string, any>; Conditions: Record<string, unknown>; Resources: Record<string, Resource>; Outputs: Record<string, any>;
};
const R = doc.Resources;

describe('deploy script arguments', () => {
  it('has sensible defaults', () => {
    expect(parseArgs([])).toMatchObject({ command: 'help', stage: 'demo', yes: false, dryRun: false, memory: 1024 });
    expect(parseArgs(['deploy'])).toMatchObject({ command: 'deploy', stage: 'demo', skipChecks: false, budgetEmail: '' });
  });
  it('reads options', () => {
    const o = parseArgs(['deploy', '--stage', 'trial', '--region', 'eu-west-1', '--profile', 'work', '--yes', '--dry-run', '--budget-email', 'a@b.co', '--budget-usd', '25', '--memory', '512', '--warm-schedule', 'rate(5 minutes)']);
    expect(o).toMatchObject({ stage: 'trial', region: 'eu-west-1', profile: 'work', yes: true, dryRun: true, budgetEmail: 'a@b.co', budgetUsd: 25, memory: 512, warmSchedule: 'rate(5 minutes)' });
    expect(parseArgs(['warmup', '--concurrency', '12', '--rounds', '2'])).toMatchObject({ command: 'warmup', concurrency: 12, rounds: 2 });
    expect(parseArgs(['destroy', '--delete-artifacts']).deleteArtifacts).toBe(true);
  });
  it('refuses nonsense with a plain message', () => {
    expect(() => parseArgs(['launch'])).toThrow(/Unknown command "launch"/);
    expect(() => parseArgs(['deploy', '--stage', 'Prod!'])).toThrow(/--stage/);
    expect(() => parseArgs(['deploy', '--stage', 'x'.repeat(21)])).toThrow(/--stage/);
    expect(() => parseArgs(['deploy', '--stage'])).toThrow(/needs a value/);
    expect(() => parseArgs(['deploy', '--memory', '300'])).toThrow(/--memory/);
    expect(() => parseArgs(['deploy', '--budget-email', 'nope'])).toThrow(/email/);
    expect(() => parseArgs(['deploy', '--frobnicate'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['warmup', '--concurrency', '0'])).toThrow(/--concurrency/);
  });
  it('names things consistently, and caches hashed files for good but never the page', () => {
    expect(stackName('demo')).toBe('bwyd-lleol-demo');
    expect(artifactBucketName('123456789012', 'eu-west-2')).toBe('bwyd-lleol-artifacts-123456789012-eu-west-2');
    expect(codeKey('abc')).toBe('lambda/abc.zip');
    expect(cacheControlFor('assets/index-abc.js')).toContain('immutable');
    expect(cacheControlFor('index.html')).toBe('no-cache');
    expect(contentTypeFor('x.html')).toContain('text/html');
    expect(contentTypeFor('assets/a.css')).toContain('text/css');
    expect(parameterOverrides(parseArgs(['deploy', '--stage', 't']), 'b', 'k')).toEqual([
      'Stage=t', 'CodeBucket=b', 'CodeKey=k', 'MemorySize=1024', 'BudgetEmail=', 'BudgetUsd=10', 'WarmSchedule=',
    ]);
  });
  it('lists only the resources it will really create', () => {
    const plain = plannedResources({ budgetEmail: '', warmSchedule: '' }).map(([id]) => id);
    expect(plain).not.toContain('Budget');
    expect(plain).not.toContain('WarmRule');
    expect(plain).toEqual(expect.arrayContaining(['Table', 'Function', 'HttpApi', 'SiteBucket', 'Distribution']));
    const full = plannedResources({ budgetEmail: 'a@b.co', warmSchedule: 'rate(5 minutes)' }).map(([id]) => id);
    expect(full).toEqual(expect.arrayContaining(['Budget', 'WarmRule', 'WarmInvokePermission']));
  });
});

describe('the CloudFormation template', () => {
  it('has data on demand, so an idle system costs nothing', () => {
    expect(R.Table.Type).toBe('AWS::DynamoDB::Table');
    expect(R.Table.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    expect(R.Table.Properties.KeySchema.map((k: { AttributeName: string }) => k.AttributeName)).toEqual(['pk', 'sk']); // what src/server/db.ts expects
  });

  it('runs the API on Lambda with the settings the bundle needs', () => {
    const p = R.Function.Properties;
    expect(p).toMatchObject({ Runtime: 'nodejs22.x', Architectures: ['arm64'], Handler: 'index.handler' });
    expect(p.Timeout).toBeLessThan(30); // API Gateway gives up at 30 seconds
    expect(p.Environment.Variables.TABLE_NAME).toEqual({ Ref: 'Table' }); // read by src/server/db.ts
    expect(Object.keys(p.Environment.Variables)).not.toContain('DYNAMODB_ENDPOINT'); // that would point it at a local database
  });

  it('lets the API do only what the code does, only to its own table', () => {
    const statement = R.FunctionRole.Properties.Policies[0].PolicyDocument.Statement[0];
    expect(statement.Resource).toEqual({ 'Fn::GetAtt': ['Table', 'Arn'] }); // never "*"
    const granted: string[] = statement.Action;
    // Every DynamoDB call the code makes, found by reading the code, must be allowed
    const dbSource = readFileSync(join(root, 'src', 'server', 'db.ts'), 'utf8');
    const used = [...dbSource.matchAll(/new (\w+)Command\(/g)].map((m) => m[1]);
    const needs: Record<string, string[]> = {
      Get: ['GetItem'], Put: ['PutItem'], Query: ['Query'], BatchWrite: ['BatchWriteItem'], Delete: ['DeleteItem'], Update: ['UpdateItem'],
      TransactWrite: ['PutItem', 'UpdateItem', 'DeleteItem'], DescribeTable: ['DescribeTable'],
    };
    for (const c of used.filter((c) => c !== 'CreateTable')) {
      expect(needs[c], `db.ts uses ${c}Command; add it to this test and the IAM policy`).toBeDefined();
      for (const action of needs[c]) expect(granted, `${c}Command needs dynamodb:${action}`).toContain(`dynamodb:${action}`);
    }
    expect(granted).not.toContain('dynamodb:*');
    expect(granted).not.toContain('dynamodb:Scan');
    expect(granted).not.toContain('dynamodb:CreateTable'); // the table is made by this template, never by the running app
  });

  it('keeps the website bucket private, readable only through this CloudFront', () => {
    expect(R.SiteBucket.Properties.PublicAccessBlockConfiguration).toEqual({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
    const s = R.SiteBucketPolicy.Properties.PolicyDocument.Statement[0];
    expect(s.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(s.Action).toBe('s3:GetObject');
    expect(JSON.stringify(s.Condition)).toContain('distribution/');
    expect(JSON.stringify(R.SiteBucketPolicy)).not.toContain('"*"');
  });

  it('serves the app from one address, with the API under /api and never cached', () => {
    const d = R.Distribution.Properties.DistributionConfig;
    expect(d.DefaultRootObject).toBe('index.html');
    expect(d.PriceClass).toBe('PriceClass_100'); // the cheapest
    const api = d.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === '/api/*');
    expect(api.TargetOriginId).toBe('api');
    expect(api.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // CachingDisabled
    expect(api.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac'); // forwards x-session and x-persona
    for (const m of ['GET', 'PUT', 'POST', 'DELETE']) expect(api.AllowedMethods).toContain(m);
    expect(d.DefaultCacheBehavior.TargetOriginId).toBe('site');
    expect(d.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    // A distribution-wide "not found becomes index.html" would turn real API errors (403, 404) into the app page
    expect(d.CustomErrorResponses).toBeUndefined();
  });

  it('serves index.html for app routes by a function that only sees the website, and leaves files alone', () => {
    const code: string = R.SpaRewrite.Properties.FunctionCode;
    const handler = new Function(`${code}; return handler;`)() as (e: { request: { uri: string } }) => { uri: string };
    const rewrite = (uri: string) => handler({ request: { uri } }).uri;
    expect(rewrite('/')).toBe('/index.html');
    expect(rewrite('/home')).toBe('/index.html');
    expect(rewrite('/lab')).toBe('/index.html');
    expect(rewrite('/assets/index-abc.js')).toBe('/assets/index-abc.js');
    expect(rewrite('/index.html')).toBe('/index.html');
    expect(JSON.stringify(R.Distribution.Properties.DistributionConfig.CacheBehaviors)).not.toContain('FunctionAssociations');
  });

  it('guards the bill: an API throttle, optional budget alert, and optional keep-warm', () => {
    expect(R.ApiStage.Properties.DefaultRouteSettings.ThrottlingRateLimit).toEqual({ Ref: 'ThrottleRate' });
    expect(doc.Parameters.ThrottleRate.Default).toBeLessThanOrEqual(200); // a ceiling on the worst case
    expect(doc.Parameters.ThrottleRate.Default).toBeGreaterThanOrEqual(100); // but room for a busy demo: each open screen makes about 2 requests a second
    expect(R.Budget.Condition).toBe('HasBudgetEmail');
    expect(doc.Parameters.BudgetEmail.Default).toBe('');
    expect(R.WarmRule.Condition).toBe('HasWarmSchedule');
    expect(doc.Parameters.WarmSchedule.Default).toBe('');
  });

  it('tells people the throttle the template really has', () => {
    expect(throttleDefault()).toBe(doc.Parameters.ThrottleRate.Default);
  });

  it('says where everything ended up', () => {
    expect(Object.keys(doc.Outputs).sort()).toEqual(['ApiEndpoint', 'DistributionId', 'FunctionName', 'SiteBucketName', 'SiteUrl', 'TableName']);
  });

  it('is deleted cleanly by destroy, taking its data with it', () => {
    for (const r of Object.values(R)) expect(r.DeletionPolicy ?? 'Delete').not.toBe('Retain');
  });

  it('uses every parameter the script passes, and only those', () => {
    const passed = parameterOverrides(parseArgs(['deploy']), 'b', 'k').map((p) => p.split('=')[0]).sort();
    const required = Object.keys(doc.Parameters).filter((k) => !('Default' in doc.Parameters[k])).sort();
    for (const r of required) expect(passed).toContain(r); // anything without a default must be supplied
    for (const p of passed) expect(Object.keys(doc.Parameters)).toContain(p);
  });
});

// Each build goes into its own folder: other test files build the API at the same moment
const scratch = () => mkdtempSync(join(tmpdir(), 'lambda-build-'));

describe('the packaged API', () => {
  it('is small, reproducible, and holds one file called index.mjs', async () => {
    const a = await buildLambda(scratch());
    const b = await buildLambda(scratch());
    expect(a.hash).toBe(b.hash); // the same code gives the same package, so unchanged code is never re-uploaded
    expect(a.zipBytes).toBeLessThan(2 * 1024 * 1024); // small means a quick cold start
    const files = unzipSync(new Uint8Array(readFileSync(a.zipPath)));
    expect(Object.keys(files)).toEqual(['index.mjs']);
    expect(new TextDecoder().decode(files['index.mjs'].slice(0, 120))).toContain('createRequire');
    expect(existsSync(a.bundlePath) && statSync(a.bundlePath).size).toBe(a.bundleBytes);
  });
});

const dbUp = await ensureTable().then(() => true, () => false);

/** An HTTP API (payload 2.0) request, as API Gateway hands it to Lambda. */
const apiGatewayEvent = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => ({
  version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '',
  headers: { host: 'abc.execute-api.eu-west-2.amazonaws.com', accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  requestContext: { domainName: 'abc.execute-api.eu-west-2.amazonaws.com', stage: '$default', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.9', userAgent: 'test' } },
  body: body === undefined ? undefined : JSON.stringify(body), isBase64Encoded: false,
});

describe.skipIf(!dbUp)('the packaged API, as AWS would run it', () => {
  // The built file is run by itself in a fresh Node, exactly as Lambda would load it, against the local test database
  async function run(events: object[]) {
    const { bundlePath } = await buildLambda(scratch());
    const script = `const { handler } = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});
      const events = JSON.parse(process.env.EVENTS);
      const out = [];
      for (const e of events) { const r = await handler(e); out.push({ statusCode: r.statusCode, headers: r.headers, body: r.body }); }
      console.log('RESULT' + JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, EVENTS: JSON.stringify(events), DYNAMODB_ENDPOINT: 'http://localhost:8000', AWS_REGION: 'eu-west-2' },
    });
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT'));
    if (!line) throw new Error(`The packaged API did not run:\n${r.stderr}\n${r.stdout}`);
    return JSON.parse(line.slice(6)) as { statusCode: number; headers: Record<string, string>; body: string }[];
  }
  const session = () => `lam-${Date.now().toString(36)}`;

  it('answers requests in the shape API Gateway sends, including a body and custom headers', async () => {
    const s = session();
    const h = { 'x-session': s, 'x-persona': 'operator' };
    const [health, personas, put, config, denied, missing] = await run([
      apiGatewayEvent('GET', '/api/health'),
      apiGatewayEvent('GET', '/api/personas', { 'x-session': s }),
      apiGatewayEvent('PUT', '/api/config', h, { delivery: 'hub_courier', hubDays: [1, 3] }),
      apiGatewayEvent('GET', '/api/config', h),
      apiGatewayEvent('PUT', '/api/config', { 'x-session': s, 'x-persona': 'corner-deli' }, { market: 'rfq' }),
      apiGatewayEvent('GET', '/api/me', { 'x-session': s, 'x-persona': 'nobody' }),
    ]);
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true });
    expect(personas.statusCode).toBe(200);
    expect(JSON.parse(personas.body).length).toBeGreaterThanOrEqual(3);
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(config.body)).toMatchObject({ delivery: 'hub_courier', hubDays: [1, 3] }); // the body and headers survived the trip
    expect(denied.statusCode).toBe(403);
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/json'); // errors stay API errors
  });

  it('copes with the keep-warm event that the template schedules', async () => {
    const rule = R.WarmRule.Properties.Targets[0].Input as string;
    const event = JSON.parse(rule);
    expect(event.rawPath).toBe('/api/health');
    const [r] = await run([event]);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });

  it('runs a whole order through, as a person would', async () => {
    const s = session();
    const op = { 'x-session': s, 'x-persona': 'operator' };
    const date = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 10); while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const [, order] = await run([
      apiGatewayEvent('PUT', '/api/config', op, { localRange: 'flat', flatRadiusKm: 200 }),
      apiGatewayEvent('POST', '/api/orders', { 'x-session': s, 'x-persona': 'corner-deli' }, { lines: [{ listingId: 'dyfed-dairy:milk-whole', qty: 10, deliveryDate: date, note: 'Back door' }] }),
    ]);
    expect(order.statusCode).toBe(200);
    expect(JSON.parse(order.body).orders[0]).toMatchObject({ producerId: 'dyfed-dairy', status: 'placed', lines: [{ qty: 10, note: 'Back door' }] });
  });
});
