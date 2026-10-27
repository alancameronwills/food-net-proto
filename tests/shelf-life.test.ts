import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';
import { availableForUse, deliverableDates, describeDays, shelfLifeFor } from '../src/shared/availability';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { deliveryRule } from '../src/shared/delivery';
import { DEFAULT_CONFIG } from '../src/shared/models';
import { buildSeed } from '../src/server/seed';
import type { Order, SupplyWindow } from '../src/shared/types';

const today = todayIso();
const seed = buildSeed(today);
const cat = (id: string) => seed.categories.find((c) => c.id === id)!;
const dates = (...d: string[]) => d.map((date) => ({ date, orderable: 10, confidence: 'in_stock' as const }));

describe('shelf life', () => {
  it('the producer figure wins over the category usual', () => {
    expect(shelfLifeFor(cat('milk'), {})).toBe(2);
    expect(shelfLifeFor(cat('milk'), { shelfLifeDays: 5 })).toBe(5);
    expect(shelfLifeFor(cat('cheese'), {})).toBe(60);
  });

  it('describes lengths of time plainly', () => {
    expect(describeDays(2)).toEqual({ unit: 'day', n: 2 });
    expect(describeDays(21)).toEqual({ unit: 'week', n: 3 });
    expect(describeDays(60)).toEqual({ unit: 'month', n: 2 });
    expect(describeDays(90)).toEqual({ unit: 'month', n: 3 });
    expect(describeDays(45)).toEqual({ unit: 'day', n: 45 });
  });

  it('can use goods delivered up to shelf-life days before the day of use, never after', () => {
    const delivery = dates('2026-11-02', '2026-11-05'); // a Monday and a Thursday
    const milk = availableForUse(delivery, 2, '2026-11-05');
    expect(milk.ok && milk.best.date).toBe('2026-11-05'); // delivered on the day
    expect(availableForUse(delivery, 2, '2026-11-04').ok).toBe(true); // Monday's delivery covers Tuesday and Wednesday
    const wed = availableForUse(delivery, 2, '2026-11-04');
    expect(wed.ok && wed.best.date).toBe('2026-11-02');
    expect(availableForUse(delivery, 2, '2026-11-03').ok).toBe(true);
    expect(availableForUse(delivery, 2, '2026-11-01').ok).toBe(false); // before the first delivery
    const wine = availableForUse(delivery, 60, '2026-12-20');
    expect(wine.ok).toBe(true); // wine delivered in early November is still good in late December
    const late = availableForUse(delivery, 60, '2027-01-05');
    expect(late).toEqual({ ok: false, shelfLife: 60, earlier: '2027-01-04', later: undefined }); // the last delivery lasts to 4 January
    const wine2 = availableForUse(delivery, 60, '2026-11-30');
    expect(wine2.ok && wine2.options.map((o) => o.date)).toEqual(['2026-11-02', '2026-11-05']); // either delivery works
  });

  it('prefers the freshest delivery that works', () => {
    const r = availableForUse(dates('2026-11-02', '2026-11-03', '2026-11-04'), 5, '2026-11-06');
    expect(r.ok && r.best.date).toBe('2026-11-04');
  });

  it('says which days either side would work when it cannot', () => {
    const delivery = dates('2026-11-02', '2026-11-12'); // Mondays-ish, ten days apart
    const r = availableForUse(delivery, 2, '2026-11-07');
    expect(r).toEqual({ ok: false, shelfLife: 2, earlier: '2026-11-04', later: '2026-11-12' });
    const none = availableForUse([], 2, '2026-11-07');
    expect(none).toEqual({ ok: false, shelfLife: 2, earlier: undefined, later: undefined });
    const early = availableForUse(delivery, 2, '2026-10-30');
    expect(early.ok === false && early.earlier).toBeUndefined();
    expect(early.ok === false && early.later).toBe('2026-11-02');
  });

  it('works out delivery days from stock and the delivery rule', () => {
    const milk = cat('milk');
    const listing = seed.listings.find((l) => l.id === 'dyfed-dairy:milk-whole')!;
    const windows = new Map(seed.windows.map((w) => [`${w.listingId}#${w.start}`, w]));
    const rule = deliveryRule(DEFAULT_CONFIG, milk, listing);
    const days = deliverableDates({ config: DEFAULT_CONFIG, category: milk, listing, rule, driveKm: 10, windows, today });
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => d.date > today && new Date(d.date + 'T00:00:00Z').getUTCDay() !== 0)).toBe(true); // milk is not delivered on Sundays
    // Seed supply runs about six weeks ahead; nothing after that
    expect(days[days.length - 1].date <= addDays(mondayOf(today), 6 * 7 + 6)).toBe(true);
    // Milk (2 days) is available for use on a Sunday if Saturday's delivery is within reach
    const sunday = days.find((d) => new Date(d.date + 'T00:00:00Z').getUTCDay() === 6 && addDays(d.date, 1) > d.date)!;
    expect(availableForUse(days, 2, addDays(sunday.date, 1)).ok).toBe(true);
  });
});

// ---- through the API ---------------------------------------------------------------------------------

const dbUp = await ensureTable().then(() => true, () => false);
let n = 0;
const newSession = () => `shl-${Date.now().toString(36)}-${n++}`;
const MONDAY = mondayOf(today);
const THURSDAY = addDays(MONDAY, 10);
const FRIDAY = addDays(MONDAY, 11);
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
async function setup(model: Record<string, unknown> = {}) {
  const sid = newSession();
  await who(sid, 'operator').put('/config', { localRange: 'flat', flatRadiusKm: 200, ...model });
  return { sid, op: who(sid, 'operator'), as: (id: string) => who(sid, id) };
}

describe.skipIf(!dbUp)('a basket with a delivery day and a note for each item', () => {
  it('splits into one order per producer and day, sharing one checkout; notes stay with their items', async () => {
    const { as } = await setup();
    const r = await as('corner-deli').post('/orders', { lines: [
      { listingId: MILK, qty: 10, deliveryDate: THURSDAY, note: 'Leave at the back door' },
      { listingId: MILK, qty: 20, deliveryDate: FRIDAY, note: 'Need it before 7am' },
      { listingId: LAMB, qty: 3, deliveryDate: THURSDAY },
    ] });
    expect(r.status).toBe(200);
    const orders = r.body.orders as Order[];
    expect(orders).toHaveLength(3); // Dyfed Dairy on Thursday, Dyfed Dairy on Friday, Teifi Butchers on Thursday
    expect(new Set(orders.map((o) => o.groupId)).size).toBe(1);
    const dairyThu = orders.find((o) => o.producerId === 'dyfed-dairy' && o.deliveryDate === THURSDAY)!;
    const dairyFri = orders.find((o) => o.producerId === 'dyfed-dairy' && o.deliveryDate === FRIDAY)!;
    expect(dairyThu.lines).toEqual([{ listingId: MILK, productId: 'milk-whole', qty: 10, unitPrice: 0.95, note: 'Leave at the back door' }]);
    expect(dairyFri.lines[0]).toMatchObject({ qty: 20, note: 'Need it before 7am' });
    expect(orders.find((o) => o.producerId === 'teifi-butchers')!.lines[0].note).toBeUndefined();
    expect(orders.every((o) => o.note === undefined)).toBe(true);
    // The producer sees both days as separate orders
    expect(((await as('dyfed-dairy').get('/orders')).body as Order[]).map((o) => o.deliveryDate).sort()).toEqual([THURSDAY, FRIDAY]);
  });

  it('each day is checked and reserved on its own', async () => {
    const { sid, op, as } = await setup({ stockTrigger: 'on_place' });
    const r = await as('corner-deli').post('/orders', { lines: [
      { listingId: MILK, qty: 10, deliveryDate: THURSDAY }, { listingId: MILK, qty: 10, deliveryDate: addDays(THURSDAY, 7) },
    ] });
    expect(r.status).toBe(200);
    const wins = (await op.get('/windows')).body as SupplyWindow[];
    const reserved = (d: string) => wins.find((w) => w.listingId === MILK && w.start === mondayOf(d))!.qtyReserved;
    expect(reserved(THURSDAY)).toBe(10);
    expect(reserved(addDays(THURSDAY, 7))).toBe(10);
    void sid;
  });

  it('two lines for the same item on the same day are merged', async () => {
    const { as } = await setup();
    const r = await as('corner-deli').post('/orders', { lines: [
      { listingId: MILK, qty: 10, deliveryDate: THURSDAY, note: 'first' }, { listingId: MILK, qty: 10, deliveryDate: THURSDAY, note: 'second' },
    ] });
    expect(r.body.orders).toHaveLength(1);
    expect(r.body.orders[0].lines).toEqual([expect.objectContaining({ qty: 20, note: 'first' })]);
  });

  it('a bad day for one item refuses the whole checkout and says which', async () => {
    const { as } = await setup({ delivery: 'area_days' });
    const r = await as('grand-hotel').post('/orders', { lines: [
      { listingId: MILK, qty: 10, deliveryDate: THURSDAY }, { listingId: MILK, qty: 10, deliveryDate: FRIDAY },
    ] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(new RegExp(`${FRIDAY}`));
    expect(((await as('grand-hotel').get('/orders')).body as Order[])).toHaveLength(0);
  });

  it('needs a day for every item, and keeps the old one-day form working', async () => {
    const { as } = await setup();
    expect((await as('corner-deli').post('/orders', { lines: [{ listingId: MILK, qty: 10 }] })).status).toBe(400);
    expect((await as('corner-deli').post('/orders', { lines: [{ listingId: MILK, qty: 10, deliveryDate: 'soon' }] })).status).toBe(400);
    const old = await as('corner-deli').post('/orders', { deliveryDate: THURSDAY, note: 'for everything', lines: [{ listingId: MILK, qty: 10 }] });
    expect(old.status).toBe(200);
    expect(old.body.orders[0]).toMatchObject({ deliveryDate: THURSDAY, note: 'for everything' });
  });

  it('a producer failing on one day still lets the other days through', async () => {
    const { as } = await setup({ stockTrigger: 'on_place' });
    await as('dyfed-dairy').put('/windows', { listingId: MILK, start: mondayOf(THURSDAY), qtyTotal: 15, confidence: 'in_stock' });
    // Each line fits its own day, but the two days share a week of stock: 12 + 12 > 15
    const r = await as('corner-deli').post('/orders', { lines: [
      { listingId: MILK, qty: 12, deliveryDate: THURSDAY }, { listingId: MILK, qty: 12, deliveryDate: FRIDAY },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.orders).toHaveLength(1);
    expect(r.body.failed).toHaveLength(1);
    expect(r.body.failed[0]).toMatchObject({ producerId: 'dyfed-dairy', deliveryDate: FRIDAY });
  });
});

describe.skipIf(!dbUp)('producers set the shelf life', () => {
  it('can add, change and clear it, with sensible limits', async () => {
    const { as } = await setup();
    const p = as('dyfed-dairy');
    expect((await p.put(`/listings/${MILK}`, { shelfLifeDays: 4 })).body.listing.shelfLifeDays).toBe(4);
    expect((await p.put(`/listings/${MILK}`, { pricePerUnit: 1 })).body.listing.shelfLifeDays).toBe(4); // untouched by other edits
    const cleared = await p.put(`/listings/${MILK}`, { shelfLifeDays: null });
    expect(cleared.body.listing.shelfLifeDays).toBeUndefined();
    for (const bad of [0, -3, 1.5, 731, 'a week']) expect((await p.put(`/listings/${MILK}`, { shelfLifeDays: bad })).status).toBe(400);
    const added = await p.post('/listings', { productId: 'meat-lamb', pricePerUnit: 15, minOrder: 2, shelfLifeDays: 90 });
    expect(added.body.listing.shelfLifeDays).toBe(90);
    expect((await as('teifi-butchers').put(`/listings/${MILK}`, { shelfLifeDays: 9 })).status).toBe(403);
  });

  it('categories publish their usual shelf life', async () => {
    const { as } = await setup();
    const cats = (await as('corner-deli').get('/bootstrap')).body.categories as { id: string; shelfLifeDays: number }[];
    expect(Object.fromEntries(cats.map((c) => [c.id, c.shelfLifeDays]))).toMatchObject({ milk: 2, bread: 2, cheese: 60 });
  });
});
