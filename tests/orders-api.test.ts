import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import type { Order, SupplyWindow } from '../src/shared/types';

// Integration tests against DynamoDB Local (`npm run db:up`); skipped when it isn't running.
const dbUp = await ensureTable().then(() => true, () => false);

let n = 0;
const newSession = () => `ord-${Date.now().toString(36)}-${n++}`;
const MONDAY = mondayOf(todayIso());
const THURSDAY = addDays(MONDAY, 10); // Thursday of next week: in stock in the seed data, and a delivery day for most categories
const FORECAST_THURSDAY = addDays(MONDAY, 17); // seeded as forecast
const PROVISIONAL_THURSDAY = addDays(MONDAY, 31); // seeded as provisional
const MILK = 'dyfed-dairy:milk-whole';
const LAMB = 'teifi-butchers:meat-lamb';

function who(sid: string, persona: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method, headers: { 'x-session': sid, 'x-persona': persona, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { get: (p: string) => call('GET', p), put: (p: string, b: unknown) => call('PUT', p, b), post: (p: string, b?: unknown) => call('POST', p, b ?? {}) };
}

/** A session where everyone is "local" to everyone, so range rules don't get in the way. */
async function setup(model: Record<string, unknown> = {}) {
  const sid = newSession();
  const op = who(sid, 'operator');
  await op.put('/config', { localRange: 'flat', flatRadiusKm: 200, ...model });
  return { sid, op, buyer: (id = 'corner-deli') => who(sid, id), producer: (id = 'dyfed-dairy') => who(sid, id) };
}

const windowOf = async (sid: string, listingId: string, date: string) =>
  ((await who(sid, 'operator').get('/windows')).body as SupplyWindow[]).find((w) => w.listingId === listingId && w.start === mondayOf(date))!;
const order = (lines: { listingId: string; qty: number }[], deliveryDate = THURSDAY, extra = {}) => ({ deliveryDate, lines, ...extra });

describe.skipIf(!dbUp)('placing orders', () => {
  it('places an order per producer, priced from the listing, sharing one checkout group', async () => {
    const { buyer } = await setup();
    const r = await buyer().post('/orders', order([{ listingId: MILK, qty: 12 }, { listingId: LAMB, qty: 4 }]));
    expect(r.status).toBe(200);
    expect(r.body.orders).toHaveLength(2);
    const [a, b] = r.body.orders as Order[];
    expect(a.groupId).toBe(b.groupId);
    expect(new Set([a.producerId, b.producerId])).toEqual(new Set(['dyfed-dairy', 'teifi-butchers']));
    const milk = r.body.orders.find((o: Order) => o.producerId === 'dyfed-dairy') as Order;
    expect(milk).toMatchObject({ status: 'placed', stock: 'none', total: 11.4, buyerId: 'corner-deli' });
    expect(milk.id).toMatch(/^BL-\d{4}$/);
  });

  it('rejects bad baskets with a clear reason', async () => {
    const { buyer, producer } = await setup();
    const b = buyer();
    expect((await b.post('/orders', order([]))).status).toBe(400);
    expect((await b.post('/orders', order([{ listingId: MILK, qty: 0 }]))).status).toBe(400);
    expect((await b.post('/orders', order([{ listingId: 'nope', qty: 10 }]))).status).toBe(404);
    expect((await b.post('/orders', { deliveryDate: 'soon', lines: [{ listingId: MILK, qty: 10 }] })).status).toBe(400);
    const below = await b.post('/orders', order([{ listingId: MILK, qty: 3 }]));
    expect(below.status).toBe(400);
    expect(below.body.error).toMatch(/minimum order is 10/);
    expect((await producer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).status).toBe(403); // producers don't buy
    const soon = await b.post('/orders', order([{ listingId: MILK, qty: 10 }], todayIso()));
    expect(soon.status).toBe(409);
    expect(soon.body.error).toMatch(/more notice/);
    const cheese = await b.post('/orders', order([{ listingId: 'dyfed-dairy:cheese-cheddar', qty: 2 }])); // cheese is delivered on Wednesdays
    expect(cheese.status).toBe(409);
    expect(cheese.body.error).toMatch(/not delivered on that day/);
    const prov = await b.post('/orders', order([{ listingId: MILK, qty: 10 }], PROVISIONAL_THURSDAY));
    expect(prov.status).toBe(409);
  });

  it('lets forecast weeks be ordered only up to the model limit', async () => {
    const { sid, op, buyer } = await setup({ forecastOrdering: 'pct_limit', forecastPct: 0.5 });
    const w = await windowOf(sid, MILK, FORECAST_THURSDAY);
    const cap = Math.floor(w.qtyTotal * 0.5);
    expect(w.confidence).toBe('forecast');
    expect((await buyer().post('/orders', order([{ listingId: MILK, qty: cap + 1 }], FORECAST_THURSDAY))).status).toBe(409);
    expect((await buyer().post('/orders', order([{ listingId: MILK, qty: cap }], FORECAST_THURSDAY))).status).toBe(200);
    await op.put('/config', { forecastOrdering: 'stock_only' });
    const blocked = await buyer('harbour-bistro').post('/orders', order([{ listingId: MILK, qty: 10 }], FORECAST_THURSDAY));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/forecast/);
  });

  it('enforces the local range per model', async () => {
    const { op, buyer } = await setup({ localRange: 'per_category', flatRadiusKm: 5 });
    // milk from Cenarth is beyond 20 km for Harbour Bistro in Fishguard
    const far = await buyer('harbour-bistro').post('/orders', order([{ listingId: MILK, qty: 10 }]));
    expect(far.status).toBe(409);
    expect(far.body.error).toMatch(/outside the local range/);
    await op.put('/config', { localRange: 'warn' });
    expect((await buyer('harbour-bistro').post('/orders', order([{ listingId: MILK, qty: 10 }]))).status).toBe(200);
  });

  it('applies volume prices only under the tiers model', async () => {
    const { producer, op, buyer } = await setup();
    await producer().put(`/listings/${MILK}`, { tiers: [{ minQty: 50, price: 0.8 }] });
    const flat = await buyer().post('/orders', order([{ listingId: MILK, qty: 50 }]));
    expect(flat.body.orders[0].total).toBe(47.5);
    await op.put('/config', { pricing: 'tiers' });
    const tiered = await buyer('grand-hotel').post('/orders', order([{ listingId: MILK, qty: 50 }]));
    expect(tiered.body.orders[0].lines[0].unitPrice).toBe(0.8);
    expect(tiered.body.orders[0].total).toBe(40);
  });
});

describe.skipIf(!dbUp)('stock reservation by model', () => {
  it('on_confirm (default): stock drops only when the producer confirms', async () => {
    const { sid, buyer, producer } = await setup();
    const before = (await windowOf(sid, MILK, THURSDAY)).qtyReserved;
    const placed = (await buyer().post('/orders', order([{ listingId: MILK, qty: 12 }]))).body.orders[0] as Order;
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(before);

    expect((await buyer().post(`/orders/${placed.id}/confirm`)).status).toBe(403);
    expect((await producer('teifi-butchers').post(`/orders/${placed.id}/confirm`)).status).toBe(403);
    const ok = await producer().post(`/orders/${placed.id}/confirm`);
    expect(ok.status).toBe(200);
    expect(ok.body.order).toMatchObject({ status: 'confirmed', stock: 'reserved' });
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(before + 12);
    expect((await producer().post(`/orders/${placed.id}/confirm`)).status).toBe(409); // not twice
    expect(ok.body.order.history.map((h: { status: string }) => h.status)).toEqual(['placed', 'confirmed']);
  });

  it('on_confirm: confirming fails, with a reason, when the stock has gone', async () => {
    const { sid, buyer, producer } = await setup();
    await producer().put('/windows', { listingId: MILK, start: mondayOf(THURSDAY), qtyTotal: 15, confidence: 'in_stock' });
    const a = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    const b = (await buyer('grand-hotel').post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order; // both fit: nothing reserved yet
    expect((await producer().post(`/orders/${a.id}/confirm`)).status).toBe(200);
    const second = await producer().post(`/orders/${b.id}/confirm`);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/Not enough stock.*only 5 available/);
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(10);
  });

  it('soft_hold: stock is held when ordered, released on decline or cancel', async () => {
    const { sid, buyer, producer } = await setup({ stockTrigger: 'soft_hold' });
    const base = (await windowOf(sid, MILK, THURSDAY)).qtyReserved;
    const a = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    expect(a).toMatchObject({ status: 'placed', stock: 'held' });
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(base + 10);

    const declined = await producer().post(`/orders/${a.id}/decline`, { reason: 'Sold out' });
    expect(declined.body.order).toMatchObject({ status: 'declined', stock: 'none' });
    expect(declined.body.order.history.at(-1).note).toBe('Sold out');
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(base);

    const b = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    expect((await producer().post(`/orders/${b.id}/confirm`)).body.order).toMatchObject({ status: 'confirmed', stock: 'reserved' });
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(base + 10); // firming does not double-count
    const c = await buyer().post(`/orders/${b.id}/cancel`);
    expect(c.body.order.status).toBe('cancelled');
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(base);
    expect((await buyer().post(`/orders/${b.id}/cancel`)).status).toBe(409); // cannot release twice
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(base);
  });

  it('on_place: orders are accepted automatically and stock drops at once', async () => {
    const { sid, buyer } = await setup({ stockTrigger: 'on_place' });
    const base = (await windowOf(sid, MILK, THURSDAY)).qtyReserved;
    const o = (await buyer().post('/orders', order([{ listingId: MILK, qty: 20 }]))).body.orders[0] as Order;
    expect(o).toMatchObject({ status: 'confirmed', stock: 'reserved' });
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(base + 20);
  });

  it('never oversells when many buyers order at the same moment', async () => {
    const { sid, producer, buyer } = await setup({ stockTrigger: 'on_place' });
    await producer().put('/windows', { listingId: MILK, start: mondayOf(THURSDAY), qtyTotal: 25, confidence: 'in_stock' });
    const buyers = ['corner-deli', 'grand-hotel', 'harbour-bistro', 'castle-caterers', 'corner-deli', 'grand-hotel'];
    const results = await Promise.all(buyers.map((id) => buyer(id).post('/orders', order([{ listingId: MILK, qty: 10 }]))));
    const won = results.filter((r) => r.status === 200).length;
    expect(won).toBe(2);
    expect(results.filter((r) => r.status === 409).every((r) => /only 5 available|changing quickly/.test(r.body.error))).toBe(true);
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(20);
  });

  it('a multi-line order is all-or-nothing for its producer', async () => {
    const { sid, producer, buyer } = await setup({ stockTrigger: 'soft_hold' });
    const CREAM = 'dyfed-dairy:cream-double';
    await producer().put('/windows', { listingId: CREAM, start: mondayOf(THURSDAY), qtyTotal: 3, confidence: 'in_stock' });
    const r = await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }, { listingId: CREAM, qty: 4 }]));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/only 3 available/);
    expect((await windowOf(sid, MILK, THURSDAY)).qtyReserved).toBe(0); // the milk line did not sneak through
  });

  it('keeps the producer stock guard honest once orders hold stock', async () => {
    const { buyer, producer } = await setup({ stockTrigger: 'on_place' });
    await buyer().post('/orders', order([{ listingId: MILK, qty: 30 }]));
    const low = await producer().put('/windows', { listingId: MILK, start: mondayOf(THURSDAY), qtyTotal: 29, confidence: 'in_stock' });
    expect(low.status).toBe(409);
  });
});

describe.skipIf(!dbUp)('who sees which orders', () => {
  it('scopes the order list by role', async () => {
    const { buyer, producer, op } = await setup();
    await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }, { listingId: LAMB, qty: 2 }]));
    await buyer('grand-hotel').post('/orders', order([{ listingId: MILK, qty: 10 }]));
    const ids = async (c: ReturnType<typeof who>) => ((await c.get('/orders')).body as Order[]).map((o) => `${o.buyerId}>${o.producerId}`).sort();
    expect(await ids(buyer())).toEqual(['corner-deli>dyfed-dairy', 'corner-deli>teifi-butchers']);
    expect(await ids(buyer('harbour-bistro'))).toEqual([]);
    expect(await ids(producer())).toEqual(['corner-deli>dyfed-dairy', 'grand-hotel>dyfed-dairy']);
    expect(await ids(producer('teifi-butchers'))).toEqual(['corner-deli>teifi-butchers']);
    expect((await ids(op)).length).toBe(3);
  });

  it('numbers orders per session and restarts after a reset', async () => {
    const { sid, buyer, op } = await setup();
    const first = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    const second = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    expect(Number(second.id.slice(3))).toBe(Number(first.id.slice(3)) + 1);
    await op.post('/admin/reset');
    expect(((await who(sid, 'operator').get('/orders')).body as Order[])).toHaveLength(0);
  });
});
