import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';
import { buildSeed } from '../src/server/seed';
import { deliverableDates, deliveryFit } from '../src/shared/availability';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { deliveryRule, isUsualDay, ruleProblem } from '../src/shared/delivery';
import { DEFAULT_CONFIG } from '../src/shared/models';
import { nextWeekday } from '../src/shared/orders';
import type { Order, RequestView, SupplyWindow } from '../src/shared/types';

const today = todayIso();
const seed = buildSeed(today);
const cheese = seed.categories.find((c) => c.id === 'cheese')!;

describe('delivery rules with a producer\'s special days (pure)', () => {
  const rule = (extra: string[] = []) => deliveryRule(DEFAULT_CONFIG, cheese, undefined, undefined, undefined, extra);

  it('a special day works whatever the weekday, but notice and the far limit still apply', () => {
    const t = '2026-10-26';
    expect(ruleProblem(rule(), '2026-11-05', t)).toBe('not_delivery_day'); // cheese goes on Wednesdays; this is a Thursday
    expect(ruleProblem(rule(['2026-11-05']), '2026-11-05', t)).toBeNull();
    expect(ruleProblem(rule(['2026-10-28']), '2026-10-28', t)).toBe('too_soon'); // cheese needs 3 days' notice
    expect(ruleProblem(rule(['2027-06-01']), '2027-06-01', t)).toBe('too_far');
    expect(ruleProblem(rule(['2026-11-05']), '2026-11-06', t)).toBe('not_delivery_day'); // only that one day
  });

  it('the hub courier ignores a producer\'s special days: it decides its own days', () => {
    const r = deliveryRule({ ...DEFAULT_CONFIG, delivery: 'hub_courier' }, cheese, undefined, undefined, undefined, ['2026-11-05']);
    expect(r.extraDates).toBeUndefined();
    expect(ruleProblem(r, '2026-11-05', '2026-10-26')).toBeNull(); // Thursday is a hub day anyway
    expect(ruleProblem(r, '2026-11-06', '2026-10-26')).toBe('not_hub_day');
  });

  it('tells usual days from special ones', () => {
    expect(isUsualDay(rule(['2026-11-05']), '2026-11-04')).toBe(true); // a Wednesday
    expect(isUsualDay(rule(['2026-11-05']), '2026-11-05')).toBe(false); // the special Thursday
  });

  it('special days show up as days a product can be delivered, marked as special', () => {
    const listing = seed.listings.find((l) => l.id === 'dyfed-dairy:cheese-cheddar')!;
    const windows = new Map(seed.windows.map((w) => [`${w.listingId}#${w.start}`, w]));
    const thursday = nextWeekday(addDays(today, 8), [4]);
    const days = (extra: string[]) => deliverableDates({ config: DEFAULT_CONFIG, category: cheese, listing, rule: rule(extra), driveKm: 10, windows, today });
    expect(days([]).map((d) => d.date)).not.toContain(thursday);
    const withExtra = days([thursday]);
    expect(withExtra.find((d) => d.date === thursday)).toMatchObject({ special: true });
    expect(withExtra.filter((d) => d.date !== thursday).every((d) => !d.special)).toBe(true);
  });

  it('judges a delivery day against the day it is needed and the shelf life', () => {
    expect(deliveryFit('2026-11-05', '2026-11-05', 2)).toBe('on_day');
    expect(deliveryFit('2026-11-05', '2026-11-04', 2)).toBe('early');
    expect(deliveryFit('2026-11-05', '2026-11-03', 2)).toBe('early'); // exactly the shelf life
    expect(deliveryFit('2026-11-05', '2026-11-02', 2)).toBe('too_early');
    expect(deliveryFit('2026-11-05', '2026-10-06', 60)).toBe('early'); // cheese keeps for two months
    expect(deliveryFit('2026-11-05', '2026-11-06', 60)).toBe('late');
  });
});

const dbUp = await ensureTable().then(() => true, () => false);
let n = 0;
const newSession = () => `spd-${Date.now().toString(36)}-${n++}`;
const MONDAY = mondayOf(today);
const NEEDED = addDays(MONDAY, 24); // a Thursday three weeks on
const WEDNESDAY_BEFORE = addDays(NEEDED, -1);
const SUNDAY_AFTER = addDays(NEEDED, 3);

function who(sid: string, persona: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method, headers: { 'x-session': sid, 'x-persona': persona, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { get: (p: string) => call('GET', p), put: (p: string, b: unknown) => call('PUT', p, b), post: (p: string, b?: unknown) => call('POST', p, b ?? {}), del: (p: string) => call('DELETE', p) };
}
async function setup(model: Record<string, unknown> = {}) {
  const sid = newSession();
  await who(sid, 'operator').put('/config', { localRange: 'flat', flatRadiusKm: 200, ...model });
  return { sid, op: who(sid, 'operator'), as: (id: string) => who(sid, id) };
}
const ask = (extra: Record<string, unknown> = {}) => ({ productId: 'cheese-cheddar', qty: 4, deliveryDate: NEEDED, ...extra });
const windowsOf = async (c: ReturnType<typeof who>) => (await c.get('/windows')).body as SupplyWindow[];

describe.skipIf(!dbUp)('bids may offer a different delivery day', () => {
  it('a request for a day the product is not normally delivered is accepted', async () => {
    const { as } = await setup();
    const r = await as('corner-deli').post('/requests', ask()); // cheese goes out on Wednesdays; NEEDED is a Thursday
    expect(r.status).toBe(200);
    expect(r.body.request).toMatchObject({ deliveryDate: NEEDED, status: 'open' });
  });

  it('a bid can name its own day: earlier within the shelf life, later, or a special delivery', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    const early = await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 13, qty: 4, deliveryDate: WEDNESDAY_BEFORE });
    expect(early.status).toBe(200);
    expect(early.body.bids[0].deliveryDate).toBe(WEDNESDAY_BEFORE);
    const plain = await as('teifi-valley-cheese').post(`/requests/${id}/bids`, { price: 12, qty: 4 });
    expect(plain.body.bids[0].deliveryDate).toBeUndefined(); // no day given: the day asked for

    const view = ((await as('corner-deli').get('/requests')).body as RequestView[])[0];
    const byProducer = Object.fromEntries(view.bids.map((b) => [b.producerId, b.deliveryDate]));
    expect(byProducer).toEqual({ 'dyfed-dairy': WEDNESDAY_BEFORE, 'teifi-valley-cheese': undefined });
  });

  it('refuses a delivery day in the past, far ahead, or that is not a date', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    const bid = (deliveryDate: string) => as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 13, qty: 4, deliveryDate });
    expect((await bid(today)).status).toBe(400);
    expect((await bid(addDays(today, -3))).status).toBe(400);
    expect((await bid(addDays(today, 400))).status).toBe(400);
    expect((await bid('next week')).status).toBe(400);
    expect((await bid(addDays(today, 1))).status).toBe(200); // tomorrow is the earliest
  });

  it('accepting delivers on the bid day, with supply in that week, and marks a non-usual day as special', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ qty: 4 }))).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 13, qty: 4, deliveryDate: WEDNESDAY_BEFORE });
    const bid = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids[0];
    const done = await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id });
    expect(done.status).toBe(200);
    expect(done.body.order).toMatchObject({ deliveryDate: WEDNESDAY_BEFORE, status: 'confirmed', total: 52 });
    expect(done.body.order.special).toBeUndefined(); // Wednesday is one of the dairy's usual cheese days
    expect((await windowsOf(as('corner-deli'))).some((w) => w.listingId === 'dyfed-dairy:cheese-cheddar' && w.start === mondayOf(WEDNESDAY_BEFORE) && w.qtyReserved >= 4)).toBe(true);
  });

  it('a delivery outside the producer\'s usual days is a special delivery', async () => {
    const { as } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 13, qty: 4, deliveryDate: SUNDAY_AFTER });
    const bid = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids[0];
    const order = (await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id })).body.order as Order;
    expect(order).toMatchObject({ deliveryDate: SUNDAY_AFTER, special: true });
    // The producer sees it, on the day, like any other delivery
    const mine = (await as('dyfed-dairy').get('/orders')).body as Order[];
    expect(mine.find((o) => o.id === order.id)).toMatchObject({ deliveryDate: SUNDAY_AFTER, special: true });
  });

  it('a request taken at the buyer\'s price (first to accept) on an unusual day is also a special delivery', async () => {
    const { as } = await setup({ speculative: 'first_accept' });
    const id = (await as('corner-deli').post('/requests', ask({ targetPrice: 12 }))).body.request.id;
    const taken = await as('dyfed-dairy').post(`/requests/${id}/take`);
    expect(taken.status).toBe(200);
    expect(taken.body.order).toMatchObject({ deliveryDate: NEEDED, special: true });
  });

  it('one pooled bid with a day applies that day to every request in the pool', async () => {
    const { as } = await setup({ speculative: 'pooled' });
    const a = (await as('corner-deli').post('/requests', ask({ qty: 2 }))).body.request.id;
    const b = (await as('grand-hotel').post('/requests', ask({ qty: 2, deliveryDate: addDays(NEEDED, 1) }))).body.request.id; // same week, a day later
    const bid = await as('dyfed-dairy').post(`/requests/${a}/bids`, { price: 13, qty: 4, deliveryDate: WEDNESDAY_BEFORE });
    expect(bid.body.bids.map((x: { deliveryDate: string }) => x.deliveryDate)).toEqual([WEDNESDAY_BEFORE, WEDNESDAY_BEFORE]);
    const forB = ((await as('grand-hotel').get('/requests')).body as RequestView[]).find((r) => r.id === b)!;
    expect(forB.bids[0].deliveryDate).toBe(WEDNESDAY_BEFORE);
  });
});

describe.skipIf(!dbUp)('producers add their own special delivery days', () => {
  it('only the producer (or the operator, naming one) can add or remove, and the day must be sensible', async () => {
    const { as, op } = await setup();
    const day = addDays(today, 10);
    expect((await as('corner-deli').post('/extra-days', { date: day })).status).toBe(403);
    expect((await op.post('/extra-days', { date: day })).status).toBe(403); // which producer?
    expect((await op.post('/extra-days', { date: day, producerId: 'corner-deli' })).status).toBe(400); // not a producer
    expect((await as('dyfed-dairy').post('/extra-days', { date: 'soon' })).status).toBe(400);
    expect((await as('dyfed-dairy').post('/extra-days', { date: today })).status).toBe(400);
    expect((await as('dyfed-dairy').post('/extra-days', { date: addDays(today, 400) })).status).toBe(400);
    const ok = await as('dyfed-dairy').post('/extra-days', { date: day, note: 'Delivering to Cardigan anyway' });
    expect(ok.status).toBe(200);
    expect(ok.body.extraDay).toEqual({ producerId: 'dyfed-dairy', date: day, note: 'Delivering to Cardigan anyway' });
    expect((await op.post('/extra-days', { date: addDays(day, 1), producerId: 'dyfed-dairy' })).status).toBe(200);

    expect((await as('brongest-creamery').del(`/extra-days?date=${day}`)).status).toBe(404); // not theirs
    expect((await as('dyfed-dairy').del(`/extra-days?date=${day}`)).status).toBe(200);
    expect((await as('dyfed-dairy').del(`/extra-days?date=${day}`)).status).toBe(404);
    const boot = (await as('corner-deli').get('/bootstrap')).body;
    expect(boot.extraDays).toEqual([{ producerId: 'dyfed-dairy', date: addDays(day, 1) }]);
  });

  it('adding the same day twice is one day; there is a limit on how many', async () => {
    const { as } = await setup();
    const day = addDays(today, 10);
    await as('dyfed-dairy').post('/extra-days', { date: day });
    await as('dyfed-dairy').post('/extra-days', { date: day, note: 'again' });
    expect((await as('corner-deli').get('/bootstrap')).body.extraDays).toHaveLength(1);
    for (let i = 1; i < 40; i++) expect((await as('dyfed-dairy').post('/extra-days', { date: addDays(today, 10 + i) })).status).toBe(200);
    expect((await as('dyfed-dairy').post('/extra-days', { date: addDays(today, 60) })).status).toBe(409);
    expect((await as('dyfed-dairy').post('/extra-days', { date: day })).status).toBe(200); // changing an existing one is always fine
  });

  it('a special day lets buyers order that producer\'s products for it, and nothing else changes', async () => {
    const { as } = await setup({ stockTrigger: 'on_place' });
    const thursday = nextWeekday(addDays(today, 10), [4]); // cheese goes out on Wednesdays
    const line = (date: string) => ({ lines: [{ listingId: 'dyfed-dairy:cheese-cheddar', qty: 2, deliveryDate: date }] });
    const before = await as('corner-deli').post('/orders', line(thursday));
    expect(before.status).toBe(409);
    expect(before.body.error).toMatch(/not delivered on that day/);

    await as('dyfed-dairy').post('/extra-days', { date: thursday });
    const after = await as('corner-deli').post('/orders', line(thursday));
    expect(after.status).toBe(200);
    expect(after.body.orders[0]).toMatchObject({ deliveryDate: thursday, status: 'confirmed', special: true }); // the producer added this day for it
    // Only that producer, and only that day
    expect((await as('corner-deli').post('/orders', { lines: [{ listingId: 'teifi-valley-cheese:cheese-cheddar', qty: 2, deliveryDate: thursday }] })).status).toBe(409);
    expect((await as('corner-deli').post('/orders', line(addDays(thursday, 1)))).status).toBe(409);
    // And notice is still needed: a day too soon is not made possible by listing it
    const soon = addDays(today, 1);
    await as('dyfed-dairy').post('/extra-days', { date: soon });
    const tooSoon = await as('corner-deli').post('/orders', line(soon));
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error).toMatch(/more notice/);
  });

  it('an ordinary order on a usual day is not special, even if the producer has other special days', async () => {
    const { as } = await setup({ stockTrigger: 'on_place' });
    await as('dyfed-dairy').post('/extra-days', { date: addDays(today, 12) });
    const wednesday = nextWeekday(addDays(today, 10), [3]);
    const r = await as('corner-deli').post('/orders', { lines: [{ listingId: 'dyfed-dairy:cheese-cheddar', qty: 2, deliveryDate: wednesday }] });
    expect(r.status).toBe(200);
    expect(r.body.orders[0].special).toBeUndefined();
  });

  it('under area rounds a special day works for every area; under the hub courier it does not apply', async () => {
    const { as, op } = await setup({ delivery: 'area_days', stockTrigger: 'on_place' });
    const friday = nextWeekday(addDays(today, 10), [5]);
    const line = { lines: [{ listingId: 'dyfed-dairy:milk-whole', qty: 10, deliveryDate: friday }] };
    expect((await as('grand-hotel').post('/orders', line)).status).toBe(409); // not on Dyfed Dairy's round to Mwnt (Mon, Thu)
    await as('dyfed-dairy').post('/extra-days', { date: friday });
    expect((await as('grand-hotel').post('/orders', line)).status).toBe(200);

    await op.put('/config', { delivery: 'hub_courier', hubDays: [2, 4] });
    expect((await as('corner-deli').post('/orders', line)).status).toBe(409); // the hub does not run on Fridays, whatever the producer would do
  });

  it('is cleared when the session is reset', async () => {
    const { as, op } = await setup();
    await as('dyfed-dairy').post('/extra-days', { date: addDays(today, 10) });
    expect((await as('corner-deli').get('/bootstrap')).body.extraDays).toHaveLength(1);
    await op.post('/admin/reset');
    expect((await as('corner-deli').get('/bootstrap')).body.extraDays).toEqual([]);
  });
});
