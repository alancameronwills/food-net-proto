import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable, session } from '../src/server/db';
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
const else_ = (extra: Record<string, unknown> = {}) => ({ productId: 'other', qty: 30, deliveryDate: DATE, note: 'Rye flour, stoneground', ...extra });
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
    expect((await b.post('/requests', ask({ deliveryDate: todayIso() }))).status).toBe(400); // today has gone
    expect((await b.post('/requests', ask({ deliveryDate: addDays(todayIso(), 400) }))).status).toBe(400);
    // A day the product is not normally delivered on (cheese: Wednesdays), or at short notice, is still a fine thing to ask for
    expect((await b.post('/requests', ask({ productId: 'cheese-blue', deliveryDate: DATE }))).status).toBe(200);
    expect((await b.post('/requests', ask({ productId: 'cheese-blue', deliveryDate: addDays(todayIso(), 1) }))).status).toBe(200);
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

describe.skipIf(!dbUp)('robustness', () => {
  const dbOf = (sid: string) => session(sid);
  // The only way to make a request from the past (the API refuses them): change a stored one, the way the app does, checking its version
  const patchRequest = async (sid: string, id: string, change: (r: any) => object) => {
    const s = dbOf(sid);
    const r = await s.get<any>('REQUEST', id);
    const tx = await s.transact([s.tPut('REQUEST', id, { ...r, ...change(r), version: r.version + 1 }, '#v = :v', { '#v': 'version' }, { ':v': r.version })]);
    expect(tx.ok).toBe(true);
  };
  const setDate = (sid: string, id: string, deliveryDate: string) => patchRequest(sid, id, () => ({ deliveryDate }));

  it('lowering a pooled bid withdraws the larger bids it no longer covers, and tells the buyer', async () => {
    const { as } = await setup({ speculative: 'pooled' });
    const ids: string[] = [];
    for (const buyer of ['corner-deli', 'grand-hotel', 'harbour-bistro']) ids.push((await as(buyer).post('/requests', ask({ qty: 25 }))).body.request.id);
    expect(((await as('dyfed-dairy').post(`/requests/${ids[0]}/bids`, { price: 0.9, qty: 75 })).body.bids as any[]).map((x) => x.qty)).toEqual([25, 25, 25]);
    const again = await as('dyfed-dairy').post(`/requests/${ids[0]}/bids`, { price: 0.9, qty: 30 });
    expect((again.body.bids as any[]).map((x) => x.qty)).toEqual([25, 5]);
    const last = ((await as('harbour-bistro').get('/requests')).body as RequestView[]).find((r) => r.id === ids[2])!;
    expect(last.bids.filter((b) => b.status === 'open')).toHaveLength(0);
    expect(last.bids[0].status).toBe('withdrawn');
    const told = (await as('harbour-bistro').get('/notifications')).body as { type: string; params: { requestId: string; producer: string } }[];
    expect(told.some((n) => n.type === 'bid_withdrawn' && n.params.requestId === ids[2] && n.params.producer === 'Dyfed Dairy')).toBe(true);
  });

  it('a producer sees pool totals only for buyers within their range', async () => {
    const { as, op } = await setup({ speculative: 'pooled' });
    const km = ((await as('dyfed-dairy').get('/bootstrap')).body.distances) as Record<string, Record<string, number>>;
    // A flat radius between the second and third nearest of four buyers, wherever the seed puts them
    const byDistance = ['corner-deli', 'grand-hotel', 'harbour-bistro', 'castle-caterers'].sort((x, y) => km[x]['dyfed-dairy'] - km[y]['dyfed-dairy']);
    const [d2, d3] = [km[byDistance[1]]['dyfed-dairy'], km[byDistance[2]]['dyfed-dairy']];
    expect(d3).toBeGreaterThan(d2); // otherwise the seed has no such split
    await op.put('/config', { localRange: 'flat', flatRadiusKm: (d2 + d3) / 2 });
    const ids: string[] = [];
    for (const b of [byDistance[0], byDistance[1], byDistance[3]]) ids.push((await as(b).post('/requests', ask({ qty: 10 }))).body.request.id);
    const seen = ((await as('dyfed-dairy').get('/requests')).body as RequestView[]);
    expect(seen.find((r) => r.id === ids[0])!.pool).toEqual({ totalQty: 20, requests: 2, buyers: 2 });
    expect(seen.some((r) => r.id === ids[2])).toBe(false);
  });

  it('accepting stops while demand requests are switched off, but a buyer can still close and a producer withdraw', async () => {
    const { as, op } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id;
    const other = (await as('grand-hotel').post('/requests', ask({ qty: 20 }))).body.request.id;
    const bid = (await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20 })).body.bids[0];
    const bid2 = (await as('dyfed-dairy').post(`/requests/${other}/bids`, { price: 0.9, qty: 20 })).body.bids[0];
    await op.put('/config', { demandOn: false });
    expect((await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id })).status).toBe(409);
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.8, qty: 20 })).status).toBe(409);
    expect((await as('grand-hotel').post(`/requests/${id}/close`)).status).toBe(403);
    expect((await as('brongest-creamery').post(`/requests/${id}/bids/${bid.id}/withdraw`)).status).toBe(403);
    expect((await as('corner-deli').post('/requests/DR-nope/close')).status).toBe(404);
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids/${bid.id}/withdraw`)).status).toBe(200);
    expect((await as('grand-hotel').post(`/requests/${other}/close`)).status).toBe(200);
    expect((await as('dyfed-dairy').post(`/requests/${other}/bids/${bid2.id}/withdraw`)).status).toBe(409); // closed with it
    await op.put('/config', { demandOn: true });
    expect(((await as('corner-deli').get('/requests')).body as RequestView[]).find((r) => r.id === id)!.bids[0].status).toBe('withdrawn');
  });

  it('withdrawing a bid tells the buyer', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id;
    const bid = (await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20 })).body.bids[0];
    await as('dyfed-dairy').post(`/requests/${id}/bids/${bid.id}/withdraw`);
    const told = (await as('corner-deli').get('/notifications')).body as { type: string; params: { producer: string } }[];
    expect(told.some((n) => n.type === 'bid_withdrawn' && n.params.producer === 'Dyfed Dairy')).toBe(true);
  });

  it('sending a pooled bid again unchanged keeps the same bids and tells nobody twice', async () => {
    const { as } = await setup({ speculative: 'pooled' });
    const a = (await as('corner-deli').post('/requests', ask({ qty: 25 }))).body.request.id;
    await as('grand-hotel').post('/requests', ask({ qty: 25 }));
    const first = (await as('dyfed-dairy').post(`/requests/${a}/bids`, { price: 0.9, qty: 50 })).body.bids as any[];
    const again = (await as('dyfed-dairy').post(`/requests/${a}/bids`, { price: 0.9, qty: 50 })).body.bids as any[];
    expect(again.map((b) => b.id)).toEqual(first.map((b) => b.id));
    const told = (await as('corner-deli').get('/notifications')).body as { type: string }[];
    expect(told.filter((n) => n.type === 'bid_placed')).toHaveLength(1);
    const changed = (await as('dyfed-dairy').post(`/requests/${a}/bids`, { price: 0.85, qty: 50 })).body.bids as any[];
    expect(changed[0].id).not.toBe(first[0].id); // a real change replaces the bid
  });

  it('a request whose delivery day has passed cannot be bid on or accepted, and drops out of pools and producers lists', async () => {
    const { sid, as } = await setup({ speculative: 'pooled' });
    const a = (await as('corner-deli').post('/requests', ask({ qty: 40 }))).body.request.id;
    const b = (await as('grand-hotel').post('/requests', ask({ qty: 40 }))).body.request.id;
    const bid = (await as('dyfed-dairy').post(`/requests/${a}/bids`, { price: 0.9, qty: 40 })).body.bids[0];
    await setDate(sid, a, addDays(todayIso(), -1));

    const buyerView = ((await as('corner-deli').get('/requests')).body as RequestView[]).find((r) => r.id === a)!;
    expect(buyerView).toMatchObject({ status: 'open', expired: true });
    expect(buyerView.pool).toBeUndefined();
    expect(((await as('brongest-creamery').get('/requests')).body as RequestView[]).map((r) => r.id)).toEqual([b]); // gone from lists...
    expect(((await as('dyfed-dairy').get('/requests')).body as RequestView[]).find((r) => r.id === a)!.expired).toBe(true); // ...but kept for who bid
    expect(((await as('brongest-creamery').get('/requests')).body as RequestView[])[0].pool).toBeUndefined(); // b is alone now

    const late = await as('brongest-creamery').post(`/requests/${a}/bids`, { price: 1, qty: 10, deliveryDate: addDays(todayIso(), 30) });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/passed/);
    const acc = await as('corner-deli').post(`/requests/${a}/accept`, { bidId: bid.id });
    expect(acc.status).toBe(409);
    expect(acc.body.error).toMatch(/passed/);
    expect((await as('corner-deli').post(`/requests/${a}/close`)).status).toBe(200); // the buyer can still tidy it away
  });

  it('a bid with its own future day cannot be accepted once the request has expired, but its producer can still withdraw it', async () => {
    const { sid, as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id;
    const bid = (await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20, deliveryDate: addDays(todayIso(), 10) })).body.bids[0];
    await setDate(sid, id, addDays(todayIso(), -1));
    const acc = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id });
    expect(acc.status).toBe(409);
    expect(acc.body.error).toMatch(/passed/);
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids/${bid.id}/withdraw`)).status).toBe(200);
  });

  it('a producer resending on a request that has expired is refused, and the stale bid is withdrawn', async () => {
    const { sid, as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20 });
    await setDate(sid, id, addDays(todayIso(), -1));
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.8, qty: 20 })).status).toBe(409);
    const view = ((await as('corner-deli').get('/requests')).body as RequestView[]).find((r) => r.id === id)!;
    expect(view.bids.map((b) => b.status)).toEqual(['withdrawn']);
    const told = (await as('corner-deli').get('/notifications')).body as { type: string }[];
    expect(told.some((n) => n.type === 'bid_withdrawn')).toBe(true);
  });

  it('a new pooled bid leaves alone a bid of theirs on an expired request in another pool, and says so when only some of it got in', async () => {
    const { sid, as } = await setup({ speculative: 'pooled' });
    const old = (await as('corner-deli').post('/requests', ask({ qty: 25 }))).body.request.id;
    await as('dyfed-dairy').post(`/requests/${old}/bids`, { price: 0.9, qty: 25 });
    await setDate(sid, old, addDays(todayIso(), -10)); // an earlier week's pool
    const fresh = (await as('grand-hotel').post('/requests', ask({ qty: 25, deliveryDate: DATE2 }))).body.request.id;
    expect((await as('dyfed-dairy').post(`/requests/${fresh}/bids`, { price: 0.9, qty: 25 })).status).toBe(200);
    const view = ((await as('corner-deli').get('/requests')).body as RequestView[]).find((r) => r.id === old)!;
    expect(view.bids.map((b) => b.status)).toEqual(['open']); // not this bid's business: the producer can withdraw it
    const told = (await as('corner-deli').get('/notifications')).body as { type: string }[];
    expect(told.some((n) => n.type === 'bid_withdrawn')).toBe(false);
  });

  it('refusals do not use up order numbers, and a bid-day refusal does not advise a later date for the request', async () => {
    const { sid, as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id;
    const bid = (await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20 })).body.bids[0];
    const id2 = (await as('grand-hotel').post('/requests', ask({ qty: 20 }))).body.request.id;
    const bid2 = (await as('dyfed-dairy').post(`/requests/${id2}/bids`, { price: 0.9, qty: 20 })).body.bids[0];
    await setDate(sid, id, addDays(todayIso(), -1));
    const refused = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error).not.toMatch(/later date/);
    const first = (await as('grand-hotel').post(`/requests/${id2}/accept`, { bidId: bid2.id })).body.order.id as string;
    const id3 = (await as('castle-caterers').post('/requests', ask({ qty: 10 }))).body.request.id;
    const bid3 = (await as('dyfed-dairy').post(`/requests/${id3}/bids`, { price: 0.9, qty: 10 })).body.bids[0];
    const second = (await as('castle-caterers').post(`/requests/${id3}/accept`, { bidId: bid3.id })).body.order.id as string;
    expect(Number(second.slice(3)) - Number(first.slice(3))).toBe(1); // no gap left by the refusal
  });

  it('the operator cannot send the config an array either', async () => {
    const { op } = await setup();
    expect((await op.put('/config', [{ demandOn: false }])).status).toBe(400);
    expect((await op.get('/config')).body.demandOn).toBe(true);
  });

  it('health answers with no session and does not make one', async () => {
    const res = await app.request('/api/health', { headers: { 'x-session': 'NOT a valid id!' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await app.request('/api/personas', { headers: { 'x-session': 'NOT a valid id!' } })).status).toBe(400); // the guard is still there for the rest
  });

  // Needs a day this week still ahead (so the pool is this week's): not possible on a Sunday
  const tomorrow = addDays(todayIso(), 1);
  it.skipIf(mondayOf(tomorrow) !== MONDAY)('resending a pooled bid withdraws the earlier bid on a pool member that has since expired', async () => {
    const { sid, as } = await setup({ speculative: 'pooled' });
    const ids: string[] = [];
    for (const buyer of ['corner-deli', 'grand-hotel', 'harbour-bistro']) ids.push((await as(buyer).post('/requests', ask({ qty: 25, deliveryDate: tomorrow }))).body.request.id);
    await as('dyfed-dairy').post(`/requests/${ids[0]}/bids`, { price: 0.9, qty: 75 });
    await setDate(sid, ids[0], MONDAY); // this week's Monday: no longer ahead, but still the same pool
    const again = await as('dyfed-dairy').post(`/requests/${ids[1]}/bids`, { price: 0.9, qty: 30 });
    expect((again.body.bids as any[]).map((b) => b.qty)).toEqual([25, 5]);
    const old = ((await as('corner-deli').get('/requests')).body as RequestView[]).find((r) => r.id === ids[0])!;
    expect(old.bids.filter((b) => b.status === 'open')).toHaveLength(0);
  });

  it('a bid whose own day has passed cannot be accepted', async () => {
    const { sid, as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id;
    const bid = (await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20, deliveryDate: addDays(todayIso(), 2) })).body.bids[0];
    await patchRequest(sid, id, (r) => ({ bids: r.bids.map((x: any) => ({ ...x, deliveryDate: todayIso() })) }));
    expect((await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id })).status).toBe(409);
    // and the producer, left with the same bid, is not stuck: sending it again without a date falls back to the day asked for
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20 })).status).toBe(200);
  });

  it('accepting makes the listing together with the order, and only when the producer has none', async () => {
    const { sid, as } = await setup();
    const id = (await as('corner-deli').post('/requests', else_({ qty: 6 }))).body.request.id;
    expect(await dbOf(sid).get('LISTING', 'nevern-bakery:cheese-blue')).toBeUndefined();
    const bid = (await as('nevern-bakery').post(`/requests/${id}/bids`, { price: 16, qty: 6, productId: 'cheese-blue' })).body.bids[0];
    expect((await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id })).status).toBe(200);
    expect(await dbOf(sid).get('LISTING', 'nevern-bakery:cheese-blue')).toMatchObject({ pricePerUnit: 16 });
    // A producer who already sells the item keeps their own listing
    const id2 = (await as('corner-deli').post('/requests', ask({ qty: 10 }))).body.request.id;
    const bid2 = (await as('dyfed-dairy').post(`/requests/${id2}/bids`, { price: 0.5, qty: 10 })).body.bids[0];
    await as('corner-deli').post(`/requests/${id2}/accept`, { bidId: bid2.id });
    expect(await dbOf(sid).get('LISTING', 'dyfed-dairy:milk-whole')).toMatchObject({ pricePerUnit: 0.95 });
  });

  it('with no product categories, requests are refused clearly instead of failing', async () => {
    const { sid, as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id;
    const s = dbOf(sid);
    for (const c of await s.list<{ id: string }>('CATEGORY')) await s.remove('CATEGORY', c.id);
    const made = await as('corner-deli').post('/requests', ask());
    expect(made.status).toBe(409);
    expect(made.body.error).toMatch(/categories/);
    expect((await as('corner-deli').post('/requests', else_())).status).toBe(409);
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 1, qty: 5 })).status).toBe(409);
    expect((await as('dyfed-dairy').get('/requests')).status).toBe(200);
    expect(((await as('dyfed-dairy').get('/requests')).body as RequestView[])).toHaveLength(0); // nobody is in range of nothing
  });

  it('odd paths and bodies get proper API errors, not a 500', async () => {
    const { as } = await setup();
    expect((await as('dyfed-dairy').put('/listings/health', { price: 1 })).status).toBe(404);
    const res = await app.request('/api/requests', { method: 'POST', headers: { 'x-session': newSession(), 'x-persona': 'corner-deli', 'content-type': 'application/json' }, body: '[1]' });
    expect(res.status).toBe(400); // an array is no body at all: the first thing missing is named
    expect((await res.json()).error).toMatch(/Unknown product/);
  });
});

describe.skipIf(!dbUp)('something else, and offering something other than what was asked for', () => {

  it('needs a note saying what is wanted, and every producer in the widest range can see it', async () => {
    const { as } = await setup({ localRange: 'category' });
    expect((await as('corner-deli').post('/requests', else_({ note: '  ' }))).status).toBe(400);
    expect((await as('corner-deli').post('/requests', { ...else_(), note: undefined })).status).toBe(400);
    const r = await as('harbour-bistro').post('/requests', else_());
    expect(r.status).toBe(200);
    expect(r.body.request).toMatchObject({ productId: 'other', qty: 30, note: 'Rye flour, stoneground', status: 'open' });
    // Harbour Bistro is too far from the dairies for milk, but "something else" uses the widest range (cheese, 100 km)
    const seen = ((await as('dyfed-dairy').get('/requests')).body as RequestView[]).some((x) => x.id === r.body.request.id);
    expect(seen).toBe(true);
  });

  it('a bid for something else must say what is offered; the order is for that item and reduces what is wanted', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', else_())).body.request.id;
    expect((await as('nevern-bakery').post(`/requests/${id}/bids`, { price: 4, qty: 10 })).status).toBe(400); // nothing named
    expect((await as('nevern-bakery').post(`/requests/${id}/bids`, { price: 4, qty: 10, productId: 'other' })).status).toBe(400);
    expect((await as('nevern-bakery').post(`/requests/${id}/bids`, { price: 4, qty: 10, productId: 'no-such' })).status).toBe(400);
    expect((await as('nevern-bakery').post(`/requests/${id}/bids`, { price: 4, qty: 31, productId: 'bread-sour' })).status).toBe(400); // more than wanted

    const bid = await as('nevern-bakery').post(`/requests/${id}/bids`, { price: 4, qty: 10, productId: 'bread-sour' });
    expect(bid.status).toBe(200);
    expect(bid.body.bids[0]).toMatchObject({ productId: 'bread-sour', qty: 10, price: 4 });

    const mine = ((await as('corner-deli').get('/requests')).body as RequestView[]).find((r) => r.id === id)!;
    const acc = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: mine.bids[0].id });
    expect(acc.status).toBe(200);
    expect(acc.body.order).toMatchObject({ producerId: 'nevern-bakery', total: 40, lines: [{ productId: 'bread-sour', qty: 10, unitPrice: 4 }] });
    expect(acc.body.request).toMatchObject({ filledQty: 10, status: 'open' }); // 20 still wanted
    const orders = (await as('nevern-bakery').get('/orders')).body as Order[];
    expect(orders.some((o) => o.lines[0].productId === 'bread-sour')).toBe(true);
  });

  it('a producer may offer a different product from the one asked for', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 20 }))).body.request.id; // 20 whole milk
    // Semi-skimmed instead; no productId at all still means the product asked for
    const bid = await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 20, productId: 'milk-semi' });
    expect(bid.status).toBe(200);
    const plain = await as('brongest-creamery').post(`/requests/${id}/bids`, { price: 1, qty: 5 });
    expect(plain.body.bids[0].productId).toBe('milk-whole');

    const view = ((await as('corner-deli').get('/requests')).body as RequestView[]).find((r) => r.id === id)!;
    const semi = view.bids.find((b) => b.producerId === 'dyfed-dairy')!;
    const acc = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: semi.id });
    expect(acc.body.order.lines[0]).toMatchObject({ productId: 'milk-semi', qty: 20 });
    expect(acc.body.request).toMatchObject({ status: 'filled', filledQty: 20 });
    expect(acc.body.request.bids.find((b: any) => b.producerId === 'brongest-creamery').status).toBe('rejected');
  });

  it('under first-to-accept the producer names what they will supply', async () => {
    const { as } = await setup({ speculative: 'first_accept' });
    const id = (await as('corner-deli').post('/requests', else_({ targetPrice: 5 }))).body.request.id;
    expect((await as('nevern-bakery').post(`/requests/${id}/take`, {})).status).toBe(400);
    const take = await as('nevern-bakery').post(`/requests/${id}/take`, { productId: 'bara-brith' });
    expect(take.status).toBe(200);
    expect(take.body.order).toMatchObject({ total: 150, lines: [{ productId: 'bara-brith', qty: 30 }] });
  });

  it('something else is never pooled with other requests', async () => {
    const { as } = await setup({ speculative: 'pooled' });
    const a = (await as('corner-deli').post('/requests', else_())).body.request.id;
    await as('grand-hotel').post('/requests', else_());
    const v = ((await as('nevern-bakery').get('/requests')).body as RequestView[]).find((r) => r.id === a)!;
    expect(v.pool).toBeUndefined();
  });
});
