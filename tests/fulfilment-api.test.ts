import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { reliabilityFor } from '../src/shared/reliability';
import type { Order, Organisation } from '../src/shared/types';

// Integration tests against DynamoDB Local (`npm run db:up`); skipped when it isn't running.
const dbUp = await ensureTable().then(() => true, () => false);

let n = 0;
const newSession = () => `ful-${Date.now().toString(36)}-${n++}`;
const MONDAY = mondayOf(todayIso());
const THURSDAY = addDays(MONDAY, 10);
const FORECAST_THURSDAY = addDays(MONDAY, 17);
const MILK = 'dyfed-dairy:milk-whole';
const CREAM = 'dyfed-dairy:cream-double';

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

async function setup(model: Record<string, unknown> = {}) {
  const sid = newSession();
  await who(sid, 'operator').put('/config', { localRange: 'flat', flatRadiusKm: 200, stockTrigger: 'on_place', ...model });
  return { sid, op: who(sid, 'operator'), buyer: (id = 'corner-deli') => who(sid, id), producer: (id = 'dyfed-dairy') => who(sid, id) };
}
const order = (lines: { listingId: string; qty: number }[], deliveryDate = THURSDAY) => ({ deliveryDate, lines });

describe.skipIf(!dbUp)('fulfilment', () => {
  it('picked, then delivered in full', async () => {
    const { buyer, producer } = await setup();
    const o = (await buyer().post('/orders', order([{ listingId: MILK, qty: 20 }, { listingId: CREAM, qty: 4 }]))).body.orders[0] as Order;
    expect(o.status).toBe('confirmed');
    expect((await buyer().post(`/orders/${o.id}/pick`)).status).toBe(403);
    expect((await producer('teifi-butchers').post(`/orders/${o.id}/pick`)).status).toBe(403);
    const picked = await producer().post(`/orders/${o.id}/pick`);
    expect(picked.body.order.status).toBe('picked');
    expect((await producer().post(`/orders/${o.id}/pick`)).status).toBe(409);
    expect((await buyer().post(`/orders/${o.id}/cancel`)).status).toBe(409); // too late once picked
    const done = await producer().post(`/orders/${o.id}/deliver`);
    expect(done.body.order).toMatchObject({ status: 'delivered', deliveredTotal: o.total });
    expect(done.body.order.history.map((h: { status: string }) => h.status)).toEqual(['confirmed', 'picked', 'delivered']);
    expect((await producer().post(`/orders/${o.id}/deliver`)).status).toBe(409);
  });

  it('a short delivery is recorded, priced by what arrived, and keeps the stock used', async () => {
    const { sid, buyer, producer } = await setup();
    const o = (await buyer().post('/orders', order([{ listingId: MILK, qty: 20 }]))).body.orders[0] as Order;
    expect((await producer().post(`/orders/${o.id}/deliver`, { lines: [{ listingId: MILK, qty: 21 }] })).status).toBe(400); // cannot exceed the order
    const r = await producer().post(`/orders/${o.id}/deliver`, { lines: [{ listingId: MILK, qty: 15 }] });
    expect(r.body.order).toMatchObject({ status: 'short', deliveredTotal: 14.25, delivered: [{ listingId: MILK, qty: 15 }] });
    const w = ((await who(sid, 'operator').get('/windows')).body as any[]).find((x) => x.listingId === MILK && x.start === mondayOf(THURSDAY));
    expect(w.qtyReserved).toBe(20); // the missing 5 are not put back on sale
  });

  it('reliability reflects deliveries, blended with the past record', async () => {
    const { buyer, producer } = await setup();
    const before = (await buyer().get('/bootstrap')).body.reliability['dyfed-dairy'];
    expect(before.orders).toBe(52); // baseline in data/organisations.json
    const o1 = (await buyer().post('/orders', order([{ listingId: MILK, qty: 20 }]))).body.orders[0] as Order;
    const o2 = (await buyer('grand-hotel').post('/orders', order([{ listingId: MILK, qty: 20 }]))).body.orders[0] as Order;
    await producer().post(`/orders/${o1.id}/deliver`);
    await producer().post(`/orders/${o2.id}/deliver`, { lines: [{ listingId: MILK, qty: 0 }] }); // nothing arrived
    const after = (await buyer().get('/bootstrap')).body.reliability['dyfed-dairy'];
    expect(after.orders).toBe(54);
    expect(after.score).toBeLessThan(before.score);
    expect(after.score).toBeCloseTo((52 * before.score + 1 + 0) / 54, 5);
  });

  it('computes reliability from orders and past record (pure)', () => {
    const org = (id: string, baseline?: Organisation['baseline']): Organisation => ({
      id, role: 'producer', name: id, kind: 'farm', town: 't', lat: 0, lon: 0, blurb: { en: '', cy: '' }, baseline,
    });
    const o = (p: string, status: Order['status'], ordered: number, got?: number) => ({
      producerId: p, status, lines: [{ qty: ordered }], delivered: got === undefined ? undefined : [{ qty: got }],
    }) as unknown as Order;
    const r = reliabilityFor([org('a'), org('b', { orders: 10, fillRate: 0.9 }), org('c')],
      [o('a', 'delivered', 10, 10), o('a', 'short', 10, 5), o('a', 'confirmed', 10), o('b', 'delivered', 4)]);
    expect(r.a).toEqual({ orders: 2, score: 0.75 }); // unfinished orders do not count
    expect(r.b.orders).toBe(11);
    expect(r.b.score).toBeCloseTo((9 + 1) / 11, 5);
    expect(r.c).toEqual({ orders: 0, score: null });
  });
});

describe.skipIf(!dbUp)('notifications and activity', () => {
  it('tells the right people, and marks them read', async () => {
    const { buyer, producer, op } = await setup({ stockTrigger: 'on_confirm' });
    const o = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    let p = (await producer().get('/notifications')).body as any[];
    expect(p.map((x) => x.type)).toEqual(['order_placed']);
    expect(p[0]).toMatchObject({ read: false, params: { orderId: o.id, buyer: 'Corner Deli', producer: 'Dyfed Dairy', productId: 'milk-whole', qty: 10 } });
    expect(((await buyer().get('/notifications')).body as any[])).toHaveLength(0);

    await producer().post(`/orders/${o.id}/confirm`);
    await producer().post(`/orders/${o.id}/deliver`, { lines: [{ listingId: MILK, qty: 6 }] });
    const b = (await buyer().get('/notifications')).body as any[];
    expect(b.map((x) => x.type)).toEqual(['order_short', 'order_confirmed']); // newest first
    expect(((await producer('teifi-butchers').get('/notifications')).body as any[])).toHaveLength(0);

    await buyer().post('/notifications/read');
    expect(((await buyer().get('/notifications')).body as any[]).every((x) => x.read)).toBe(true);
    p = (await producer().get('/notifications')).body;
    expect(p.every((x: any) => !x.read)).toBe(true); // only the buyer's were marked

    const feed = (await op.get('/activity')).body as any[];
    expect(feed.map((x) => x.type)).toEqual(['order_short', 'order_confirmed', 'order_placed']);
  });

  it('reports a decline reason and a cancellation', async () => {
    const { buyer, producer } = await setup({ stockTrigger: 'on_confirm' });
    const a = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    await producer().post(`/orders/${a.id}/decline`, { reason: 'No milk' });
    expect(((await buyer().get('/notifications')).body as any[])[0]).toMatchObject({ type: 'order_declined', params: { reason: 'No milk' } });
    const b = (await buyer().post('/orders', order([{ listingId: MILK, qty: 10 }]))).body.orders[0] as Order;
    await buyer().post(`/orders/${b.id}/cancel`);
    expect(((await producer().get('/notifications')).body as any[])[0].type).toBe('order_cancelled');
  });
});

describe.skipIf(!dbUp)('supply cuts flag affected orders', () => {
  async function threeOrders(sid: string) {
    const producer = who(sid, 'dyfed-dairy');
    await producer.put('/windows', { listingId: MILK, start: mondayOf(FORECAST_THURSDAY), qtyTotal: 100, confidence: 'forecast' });
    await who(sid, 'operator').put('/config', { forecastOrdering: 'pct_limit', forecastPct: 0.7 });
    const ids: string[] = [];
    for (const b of ['corner-deli', 'grand-hotel', 'harbour-bistro']) {
      const r = await who(sid, b).post('/orders', order([{ listingId: MILK, qty: 20 }], FORECAST_THURSDAY));
      expect(r.status).toBe(200);
      ids.push(r.body.orders[0].id);
    }
    return { producer, ids };
  }
  const flagsOf = async (sid: string, buyer: string) => ((await who(sid, buyer).get('/orders')).body as Order[])[0].flags ?? [];

  it('flags only the orders that no longer fit, newest first to lose, then clears when supply returns', async () => {
    const { sid } = await setup();
    const { producer } = await threeOrders(sid);
    const same = await producer.put('/windows', { listingId: MILK, start: mondayOf(FORECAST_THURSDAY), qtyTotal: 90, confidence: 'forecast' });
    expect(same.body.flagged).toBe(0); // 70% of 90 = 63 still covers 60

    const cut = await producer.put('/windows', { listingId: MILK, start: mondayOf(FORECAST_THURSDAY), qtyTotal: 70, confidence: 'forecast' });
    expect(cut.status).toBe(200);
    expect(cut.body.flagged).toBe(1); // 70% of 70 = 49: the first two (40) fit, the third is 11 short
    expect(await flagsOf(sid, 'corner-deli')).toEqual([]);
    expect(await flagsOf(sid, 'grand-hotel')).toEqual([]);
    expect(await flagsOf(sid, 'harbour-bistro')).toMatchObject([{ listingId: MILK, shortBy: 11 }]);
    expect(((await who(sid, 'harbour-bistro').get('/notifications')).body as any[])[0]).toMatchObject({ type: 'supply_cut', params: { qty: 11 } });

    const again = await producer.put('/windows', { listingId: MILK, start: mondayOf(FORECAST_THURSDAY), qtyTotal: 70, confidence: 'forecast' });
    expect(again.body.flagged).toBe(1); // still one order short, and no second notification
    expect(((await who(sid, 'harbour-bistro').get('/notifications')).body as any[]).filter((x) => x.type === 'supply_cut')).toHaveLength(1);
    const restored = await producer.put('/windows', { listingId: MILK, start: mondayOf(FORECAST_THURSDAY), qtyTotal: 100, confidence: 'forecast' });
    expect(restored.body.flagged).toBe(0);
    expect(await flagsOf(sid, 'harbour-bistro')).toEqual([]); // cleared itself
  });

  it('firmer-to-looser confidence also counts, and the buyer can keep the order', async () => {
    const { sid } = await setup();
    const { producer } = await threeOrders(sid);
    const cut = await producer.put('/windows', { listingId: MILK, start: mondayOf(FORECAST_THURSDAY), qtyTotal: 100, confidence: 'provisional' });
    expect(cut.body.flagged).toBe(3);
    const mine = ((await who(sid, 'grand-hotel').get('/orders')).body as Order[])[0];
    expect(mine.flags).toMatchObject([{ listingId: MILK, shortBy: 20 }]);
    expect((await who(sid, 'harbour-bistro').post(`/orders/${mine.id}/dismiss-flags`)).status).toBe(403);
    const kept = await who(sid, 'grand-hotel').post(`/orders/${mine.id}/dismiss-flags`);
    expect(kept.body.order.flags).toEqual([]);
    expect(kept.body.order.status).toBe('confirmed'); // still their order
  });
});
