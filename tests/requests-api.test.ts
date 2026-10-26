import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import type { Listing, Order, RequestView, SupplyWindow } from '../src/shared/types';

// Integration tests against DynamoDB Local (`npm run db:up`); skipped when it isn't running.
const dbUp = await ensureTable().then(() => true, () => false);

let n = 0;
const newSession = () => `req-${Date.now().toString(36)}-${n++}`;
const MONDAY = mondayOf(todayIso());
const DATE = addDays(MONDAY, 24); // a Thursday three weeks on: nobody lists supply that far out yet
const DATE2 = addDays(MONDAY, 25); // the Friday of the same week

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
  await who(sid, 'operator').put('/config', { localRange: 'flat', flatRadiusKm: 200, ...model });
  return { sid, op: who(sid, 'operator'), as: (id: string) => who(sid, id) };
}
const ask = (extra: Record<string, unknown> = {}) => ({ productId: 'milk-whole', qty: 120, deliveryDate: DATE, ...extra });

describe.skipIf(!dbUp)('creating requests', () => {
  it('records a request and tells in-range producers', async () => {
    const { as } = await setup();
    const r = await as('corner-deli').post('/requests', ask({ targetPrice: 0.9, note: 'For the breakfast service' }));
    expect(r.status).toBe(200);
    expect(r.body.request).toMatchObject({ buyerId: 'corner-deli', productId: 'milk-whole', qty: 120, status: 'open', filledQty: 0, bidCount: 0, targetPrice: 0.9 });
    expect(r.body.request.id).toMatch(/^DR-\d+$/);
    expect(r.body.request.version).toBeUndefined();
    const note = ((await as('dyfed-dairy').get('/notifications')).body as any[])[0];
    expect(note).toMatchObject({ type: 'request_new', params: { buyer: 'Corner Deli', productId: 'milk-whole', qty: 120 } });
  });

  it('only tells producers within range, and hides requests from those out of range', async () => {
    const { op, as } = await setup({ localRange: 'per_category', flatRadiusKm: 5 });
    const r = await as('harbour-bistro').post('/requests', ask()); // milk: 20 km limit
    const id = r.body.request.id;
    const dairies = ['dyfed-dairy', 'brongest-creamery', 'teifi-valley-cheese'];
    const seen: string[] = [];
    for (const p of dairies) if (((await as(p).get('/requests')).body as RequestView[]).some((x) => x.id === id)) seen.push(p);
    for (const p of dairies) expect(((await as(p).get('/notifications')).body as any[]).length > 0).toBe(seen.includes(p));
    const outside = dairies.find((p) => !seen.includes(p));
    if (outside) {
      const bid = await as(outside).post(`/requests/${id}/bids`, { price: 1, qty: 10 });
      expect(bid.status).toBe(403);
    }
    expect((await op.get('/requests')).body).toHaveLength(1);
  });

  it('validates the request', async () => {
    const { as } = await setup();
    const b = as('corner-deli');
    expect((await b.post('/requests', ask({ productId: 'unicorn' }))).status).toBe(400);
    expect((await b.post('/requests', ask({ qty: 0 }))).status).toBe(400);
    expect((await b.post('/requests', ask({ deliveryDate: 'whenever' }))).status).toBe(400);
    expect((await b.post('/requests', ask({ targetPrice: -1 }))).status).toBe(400);
    expect((await b.post('/requests', ask({ deliveryDate: todayIso() }))).body.error).toMatch(/notice/);
    expect((await b.post('/requests', ask({ productId: 'cheese-blue', deliveryDate: DATE }))).body.error).toMatch(/not delivered on that day/); // cheese: Wednesdays
    expect((await as('dyfed-dairy').post('/requests', ask())).status).toBe(403); // producers do not ask
  });

  it('first-to-accept needs a price', async () => {
    const { as } = await setup({ speculative: 'first_accept' });
    expect((await as('corner-deli').post('/requests', ask())).status).toBe(400);
    expect((await as('corner-deli').post('/requests', ask({ targetPrice: 0.9 }))).status).toBe(200);
  });
});

describe.skipIf(!dbUp)('open RFQ: bids and accepting', () => {
  it('sealed bids: producers see only their own, the buyer sees all, and bids can be replaced or withdrawn', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    const a = await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 100, note: 'Fresh daily' });
    expect(a.status).toBe(200);
    await as('brongest-creamery').post(`/requests/${id}/bids`, { price: 0.92, qty: 60 });

    const mine = ((await as('dyfed-dairy').get('/requests')).body as RequestView[]).find((r) => r.id === id)!;
    expect(mine.bids).toHaveLength(1);
    expect(mine.bids[0]).toMatchObject({ producerId: 'dyfed-dairy', price: 0.95, qty: 100 });
    expect(mine.bidCount).toBe(2); // they know how many, not what

    const buyerView = ((await as('corner-deli').get('/requests')).body as RequestView[])[0];
    expect(buyerView.bids.map((b) => b.producerId).sort()).toEqual(['brongest-creamery', 'dyfed-dairy']);
    expect(((await as('corner-deli').get('/notifications')).body as any[]).filter((x) => x.type === 'bid_placed')).toHaveLength(2);

    // Re-bidding replaces the old bid
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 100 });
    const again = ((await as('corner-deli').get('/requests')).body as RequestView[])[0];
    expect(again.bids.filter((b) => b.producerId === 'dyfed-dairy' && b.status === 'open')).toHaveLength(1);
    expect(again.bids.find((b) => b.producerId === 'dyfed-dairy' && b.status === 'open')!.price).toBe(0.9);

    const bid = again.bids.find((b) => b.producerId === 'brongest-creamery')!;
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids/${bid.id}/withdraw`)).status).toBe(403);
    expect((await as('brongest-creamery').post(`/requests/${id}/bids/${bid.id}/withdraw`)).status).toBe(200);
    expect((await as('brongest-creamery').post(`/requests/${id}/bids/${bid.id}/withdraw`)).status).toBe(409);
  });

  it('rejects bad bids', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 50 }))).body.request.id;
    const p = as('dyfed-dairy');
    expect((await p.post(`/requests/${id}/bids`, { price: 0, qty: 10 })).status).toBe(400);
    expect((await p.post(`/requests/${id}/bids`, { price: 1, qty: 0 })).status).toBe(400);
    expect((await p.post(`/requests/${id}/bids`, { price: 1, qty: 51 })).status).toBe(400);
    expect((await as('grand-hotel').post(`/requests/${id}/bids`, { price: 1, qty: 10 })).status).toBe(403); // buyers do not bid
    expect((await p.post('/requests/DR-nope/bids', { price: 1, qty: 10 })).status).toBe(404);
  });

  it('accepting a bid makes a confirmed order, a listing and supply; two bids can fill a request together', async () => {
    const { sid, as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    await as('preseli-hill-farm').post(`/requests/${id}/bids`, { price: 1.1, qty: 70, note: 'Our first milk!' }); // sells no milk today
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 100 });
    const bids = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids;
    const farm = bids.find((b) => b.producerId === 'preseli-hill-farm')!;
    const dairy = bids.find((b) => b.producerId === 'dyfed-dairy')!;

    expect((await as('grand-hotel').post(`/requests/${id}/accept`, { bidId: farm.id })).status).toBe(403); // not their request
    expect((await as('preseli-hill-farm').post(`/requests/${id}/accept`, { bidId: farm.id })).status).toBe(403);
    const ok = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: farm.id });
    expect(ok.status).toBe(200);
    expect(ok.body.order).toMatchObject({
      buyerId: 'corner-deli', producerId: 'preseli-hill-farm', status: 'confirmed', stock: 'reserved', total: 77, deliveryDate: DATE,
      source: { requestId: id, bidId: farm.id }, lines: [{ listingId: 'preseli-hill-farm:milk-whole', qty: 70, unitPrice: 1.1 }],
    });
    expect(ok.body.request).toMatchObject({ status: 'open', filledQty: 70 });

    // The producer now lists milk, with exactly the promised supply already spoken for
    const boot = (await as('corner-deli').get('/bootstrap')).body;
    expect((boot.listings as Listing[]).find((l) => l.id === 'preseli-hill-farm:milk-whole')).toMatchObject({ pricePerUnit: 1.1 });
    const w = ((await as('corner-deli').get('/windows')).body as SupplyWindow[]).find((x) => x.listingId === 'preseli-hill-farm:milk-whole')!;
    expect(w).toMatchObject({ start: mondayOf(DATE), qtyTotal: 70, qtyReserved: 70, confidence: 'in_stock' });
    expect(((await as('preseli-hill-farm').get('/notifications')).body as any[]).some((x) => x.type === 'bid_accepted')).toBe(true);

    // 70 of 120 filled: a 100 bid no longer fits
    const tooBig = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: dairy.id });
    expect(tooBig.status).toBe(409);
    expect(tooBig.body.error).toMatch(/Only 50 is still wanted/);
    // ...but the dairy can offer the remaining 50
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 50 });
    const dairy2 = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids.find((b) => b.producerId === 'dyfed-dairy' && b.status === 'open')!;
    const done = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: dairy2.id });
    expect(done.body.request).toMatchObject({ status: 'filled', filledQty: 120 });
    expect(((await as('corner-deli').get('/orders')).body as Order[])).toHaveLength(2);
    expect((await as('corner-deli').post(`/requests/${id}/accept`, { bidId: dairy2.id })).status).toBe(409); // already filled
    void sid;
  });

  it('adds to an existing week without eating into other stock', async () => {
    const { as } = await setup();
    await as('dyfed-dairy').put('/windows', { listingId: 'dyfed-dairy:milk-whole', start: mondayOf(DATE), qtyTotal: 100, confidence: 'forecast' });
    const id = (await as('corner-deli').post('/requests', ask({ qty: 30 }))).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 30 });
    const bid = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids[0];
    await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id });
    const w = ((await as('corner-deli').get('/windows')).body as SupplyWindow[]).find((x) => x.listingId === 'dyfed-dairy:milk-whole' && x.start === mondayOf(DATE))!;
    expect(w).toMatchObject({ qtyTotal: 130, qtyReserved: 30, confidence: 'forecast' });
  });

  it('filling a request rejects the remaining bids and tells those producers', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 40 }))).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 40 });
    await as('brongest-creamery').post(`/requests/${id}/bids`, { price: 0.99, qty: 40 });
    const bids = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids;
    await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bids.find((b) => b.producerId === 'dyfed-dairy')!.id });
    const after = ((await as('corner-deli').get('/requests')).body as RequestView[])[0];
    expect(after.bids.find((b) => b.producerId === 'brongest-creamery')!.status).toBe('rejected');
    expect(((await as('brongest-creamery').get('/notifications')).body as any[])[0].type).toBe('bid_rejected');
    expect((await as('brongest-creamery').post(`/requests/${id}/bids`, { price: 0.5, qty: 10 })).status).toBe(409);
  });

  it('closing withdraws the request and rejects open bids', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 100 });
    expect((await as('grand-hotel').post(`/requests/${id}/close`)).status).toBe(403);
    const closed = await as('corner-deli').post(`/requests/${id}/close`);
    expect(closed.body.request.status).toBe('closed');
    expect(closed.body.request.bids[0].status).toBe('rejected');
    expect(((await as('dyfed-dairy').get('/notifications')).body as any[])[0].type).toBe('request_closed');
    expect((await as('corner-deli').post(`/requests/${id}/close`)).status).toBe(409);
  });

  it('never double-fills when a buyer accepts two bids at once', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 50 }))).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 50 });
    await as('brongest-creamery').post(`/requests/${id}/bids`, { price: 0.9, qty: 50 });
    const bids = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids;
    const results = await Promise.all(bids.map((b) => as('corner-deli').post(`/requests/${id}/accept`, { bidId: b.id })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(((await as('corner-deli').get('/orders')).body as Order[])).toHaveLength(1);
    expect(((await as('corner-deli').get('/requests')).body as RequestView[])[0].filledQty).toBe(50);
  });
});

describe.skipIf(!dbUp)('first-to-accept', () => {
  it('has no bidding; the first producer to accept wins at the buyer price', async () => {
    const { as } = await setup({ speculative: 'first_accept' });
    const id = (await as('corner-deli').post('/requests', ask({ qty: 60, targetPrice: 0.9 }))).body.request.id;
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.8, qty: 60 })).status).toBe(409);
    const results = await Promise.all(['dyfed-dairy', 'brongest-creamery', 'teifi-valley-cheese'].map((p) => as(p).post(`/requests/${id}/take`)));
    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(winners[0].body.order).toMatchObject({ status: 'confirmed', stock: 'reserved', total: 54, lines: [{ qty: 60, unitPrice: 0.9 }] });
    expect(results.filter((r) => r.status === 409).every((r) => /already accepted|already filled|got there first/.test(r.body.error))).toBe(true);
    expect(((await as('corner-deli').get('/requests')).body as RequestView[])[0]).toMatchObject({ status: 'filled', filledQty: 60 });
    expect(((await as('corner-deli').get('/orders')).body as Order[])).toHaveLength(1);
    // The producers who missed out are told it has gone; the winner is told they won
    const winner = winners[0].body.order.producerId as string;
    for (const p of ['dyfed-dairy', 'brongest-creamery', 'teifi-valley-cheese']) {
      const types = ((await as(p).get('/notifications')).body as any[]).map((x) => x.type);
      expect(types.includes(p === winner ? 'bid_accepted' : 'request_filled')).toBe(true);
    }
  });

  it('cannot be used when a request has no price or the model is not first-to-accept', async () => {
    const { op, as } = await setup({ speculative: 'open_rfq' });
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    expect((await as('dyfed-dairy').post(`/requests/${id}/take`)).status).toBe(409); // wrong model
    await op.put('/config', { speculative: 'first_accept' });
    expect((await as('dyfed-dairy').post(`/requests/${id}/take`)).status).toBe(409); // no target price on this one
    expect((await as('corner-deli').post(`/requests/${id}/take`)).status).toBe(403); // buyers cannot
  });
});

describe.skipIf(!dbUp)('pooled demand', () => {
  it('merges requests for the same product and week; one producer bid is shared out', async () => {
    const { as } = await setup({ speculative: 'pooled' });
    const a = (await as('corner-deli').post('/requests', ask({ qty: 40 }))).body.request.id;
    const b = (await as('grand-hotel').post('/requests', ask({ qty: 40, deliveryDate: DATE2 }))).body.request.id; // same week, another day
    const c = (await as('harbour-bistro').post('/requests', ask({ qty: 40 }))).body.request.id;
    const other = (await as('castle-caterers').post('/requests', ask({ qty: 25, productId: 'eggs-free', deliveryDate: DATE }))).body.request.id; // a different pool

    const view = ((await as('dyfed-dairy').get('/requests')).body as RequestView[]);
    expect(view.find((r) => r.id === a)!.pool).toEqual({ totalQty: 120, requests: 3, buyers: 3 });
    expect(view.find((r) => r.id === other)!.pool).toBeUndefined(); // alone in its pool

    // One bid for 100 units covers the first two requests fully and the third partly
    const bid = await as('dyfed-dairy').post(`/requests/${a}/bids`, { price: 0.93, qty: 100 });
    expect(bid.status).toBe(200);
    expect((bid.body.bids as any[]).map((x) => x.qty)).toEqual([40, 40, 20]);
    for (const [buyer, id, qty] of [['corner-deli', a, 40], ['grand-hotel', b, 40], ['harbour-bistro', c, 20]] as const) {
      const r = ((await as(buyer).get('/requests')).body as RequestView[]).find((x) => x.id === id)!;
      expect(r.bids).toMatchObject([{ producerId: 'dyfed-dairy', price: 0.93, qty }]);
      expect(r.pool).toMatchObject({ requests: 3 }); // buyers see that they are pooled, not who with
    }
    // Each buyer decides for themselves
    const mine = ((await as('grand-hotel').get('/requests')).body as RequestView[]).find((r) => r.id === b)!;
    expect((await as('grand-hotel').post(`/requests/${b}/accept`, { bidId: mine.bids[0].id })).body.order).toMatchObject({ total: 37.2, lines: [{ qty: 40, unitPrice: 0.93 }] });
    expect(((await as('corner-deli').get('/orders')).body as Order[])).toHaveLength(0);
  });
});
