import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { buildRuns, deliveryRule, nearestArea, ruleProblem } from '../src/shared/delivery';
import { DEFAULT_CONFIG, sanitiseConfig } from '../src/shared/models';
import { buildSeed } from '../src/server/seed';
import type { Order, Organisation } from '../src/shared/types';

const seed = buildSeed('2026-10-26');
const milk = seed.categories.find((c) => c.id === 'milk')!;
const cheese = seed.categories.find((c) => c.id === 'cheese')!;
const org = (id: string) => seed.orgs.find((o) => o.id === id)!;
const cfg = (delivery: string, extra = {}) => ({ ...DEFAULT_CONFIG, delivery, ...extra });

describe('delivery rules (pure)', () => {
  it('producer delivers: the category usual days', () => {
    const r = deliveryRule(cfg('producer'), cheese);
    expect(r).toEqual({ mode: 'producer', days: [3], lead: 3 });
    expect(ruleProblem(r, '2026-11-04', '2026-10-26')).toBeNull(); // a Wednesday
    expect(ruleProblem(r, '2026-11-05', '2026-10-26')).toBe('not_delivery_day');
    expect(ruleProblem(r, '2026-10-28', '2026-10-26')).toBe('too_soon');
    expect(ruleProblem(r, '2027-06-02', '2026-10-26')).toBe('too_far');
  });

  it('area days: the producer round for the buyer area replaces the category days', () => {
    const dairy = org('dyfed-dairy');
    const hotel = org('grand-hotel'); // Mwnt
    expect(hotel.area).toBe('teifi');
    const r = deliveryRule(cfg('area_days'), cheese, undefined, dairy, hotel.area);
    expect(r.days).toEqual(dairy.routes!.teifi); // Monday and Thursday, even though cheese is normally a Wednesday product
    expect(ruleProblem(r, '2026-11-05', '2026-10-26')).toBeNull(); // Thursday
    expect(ruleProblem(r, '2026-11-04', '2026-10-26')).toBe('not_route_day');
  });

  it('area days: no round to an area means no delivery there; no routes at all falls back to category days', () => {
    const cheesemaker = org('teifi-valley-cheese');
    const r = deliveryRule(cfg('area_days'), milk, undefined, cheesemaker, 'newport');
    expect(r.days).toEqual([]);
    expect(ruleProblem(r, '2026-11-05', '2026-10-26')).toBe('no_route');
    const noRoutes: Organisation = { ...cheesemaker, routes: undefined };
    expect(deliveryRule(cfg('area_days'), milk, undefined, noRoutes, 'newport').days).toEqual(milk.deliveryDays);
  });

  it('hub courier: hub days, with the hub notice period', () => {
    const r = deliveryRule(cfg('hub_courier', { hubDays: [2, 4] }), milk);
    expect(r).toEqual({ mode: 'hub_courier', days: [2, 4], lead: 2 }); // milk needs 1 day elsewhere
    expect(ruleProblem(r, '2026-10-27', '2026-10-26')).toBe('too_soon'); // a Tuesday, but tomorrow
    expect(ruleProblem(r, '2026-11-03', '2026-10-26')).toBeNull(); // Tuesday next week
    expect(ruleProblem(r, '2026-11-04', '2026-10-26')).toBe('not_hub_day'); // Wednesday
  });

  it('finds the nearest area, so edited locations still belong somewhere', () => {
    expect(nearestArea(seed.areas, 52.0, -4.98)).toBe('fishguard');
    expect(nearestArea(seed.areas, 52.04, -4.5)).toBe('upper-teifi');
    expect(nearestArea([], 52, -4)).toBeUndefined();
  });

  it('config keeps hub days valid', () => {
    expect(sanitiseConfig({ hubDays: [5, 1, 1, 9, -1, 'x'] }).hubDays).toEqual([1, 5]);
    expect(sanitiseConfig({ hubDays: [] }).hubDays).toEqual(DEFAULT_CONFIG.hubDays);
    expect(sanitiseConfig({ hubDays: 'tue' }).hubDays).toEqual(DEFAULT_CONFIG.hubDays);
  });

  it('every producer route in the data uses a real area and sensible days', () => {
    const areas = new Set(seed.areas.map((a) => a.id));
    for (const o of seed.orgs.filter((x) => x.routes)) {
      for (const [a, days] of Object.entries(o.routes!)) {
        expect(areas.has(a)).toBe(true);
        expect(days.every((d) => d >= 0 && d <= 6)).toBe(true);
      }
    }
  });
});

describe('run sheets (pure)', () => {
  const o = (id: string, buyerId: string, producerId: string, date: string, status: Order['status'] = 'confirmed'): Order => ({
    id, groupId: id, buyerId, producerId, deliveryDate: date, status, stock: 'reserved', total: 10, createdAt: '', history: [],
    lines: [{ listingId: `${producerId}:milk-whole`, productId: 'milk-whole', qty: 10, unitPrice: 1 }],
  });
  it('groups by date and buyer, and counts the drops a hub would save', () => {
    const runs = buildRuns([
      o('1', 'corner-deli', 'dyfed-dairy', '2026-11-05'), o('2', 'corner-deli', 'teifi-butchers', '2026-11-05'), o('3', 'corner-deli', 'nevern-bakery', '2026-11-05'),
      o('4', 'grand-hotel', 'dyfed-dairy', '2026-11-05'), o('5', 'grand-hotel', 'dyfed-dairy', '2026-11-06'),
      o('6', 'grand-hotel', 'dyfed-dairy', '2026-11-06', 'delivered'), o('7', 'grand-hotel', 'dyfed-dairy', '2026-11-06', 'cancelled'),
    ], seed.orgs);
    expect(runs.map((r) => r.date)).toEqual(['2026-11-05', '2026-11-06']); // delivered and cancelled orders are not on the sheet
    expect(runs[0]).toMatchObject({ separateDrops: 4, consolidatedDrops: 2 });
    expect(runs[0].stops.map((s) => s.buyerId).sort()).toEqual(['corner-deli', 'grand-hotel']);
    expect(runs[0].stops.find((s) => s.buyerId === 'corner-deli')!.lines).toHaveLength(3);
    expect(runs[1]).toMatchObject({ separateDrops: 1, consolidatedDrops: 1 });
  });
  it('can include orders not yet confirmed', () => {
    expect(buildRuns([o('1', 'corner-deli', 'dyfed-dairy', '2026-11-05', 'placed')], seed.orgs)).toHaveLength(0);
    expect(buildRuns([o('1', 'corner-deli', 'dyfed-dairy', '2026-11-05', 'placed')], seed.orgs, { includePlaced: true })).toHaveLength(1);
  });
});

// ---- through the API -------------------------------------------------------------------------

const dbUp = await ensureTable().then(() => true, () => false);
let n = 0;
const newSession = () => `del-${Date.now().toString(36)}-${n++}`;
const MONDAY = mondayOf(todayIso());
const THURSDAY = addDays(MONDAY, 10);
const FRIDAY = addDays(MONDAY, 11);
const MILK = 'dyfed-dairy:milk-whole';

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
async function setup(model: Record<string, unknown>) {
  const sid = newSession();
  await who(sid, 'operator').put('/config', { localRange: 'flat', flatRadiusKm: 200, stockTrigger: 'on_place', ...model });
  return { sid, op: who(sid, 'operator'), as: (id: string) => who(sid, id) };
}
const order = (date: string, listingId = MILK, qty = 10) => ({ deliveryDate: date, lines: [{ listingId, qty }] });

describe.skipIf(!dbUp)('delivery models through the API', () => {
  it('gives buyers an area, and publishes the areas', async () => {
    const { as } = await setup({});
    const boot = (await as('grand-hotel').get('/bootstrap')).body;
    expect(boot.areas.map((a: any) => a.id)).toEqual(expect.arrayContaining(['fishguard', 'teifi']));
    expect(boot.orgs.find((o: any) => o.id === 'harbour-bistro').area).toBe('fishguard');
    expect(boot.orgs.find((o: any) => o.id === 'dyfed-dairy').routes.teifi).toEqual([1, 4]);
  });

  it('producer delivers: any usual delivery day works, and the mode is recorded', async () => {
    const { as } = await setup({ delivery: 'producer' });
    const r = await as('grand-hotel').post('/orders', order(FRIDAY));
    expect(r.status).toBe(200);
    expect(r.body.orders[0].deliveryMode).toBe('producer');
  });

  it('area days: only the producer round for your area', async () => {
    const { as } = await setup({ delivery: 'area_days' });
    const hotel = as('grand-hotel'); // Dyfed Dairy serves the Teifi estuary on Mondays and Thursdays
    const no = await hotel.post('/orders', order(FRIDAY));
    expect(no.status).toBe(409);
    expect(no.body.error).toMatch(/not on this producer's delivery round to your area/);
    const yes = await hotel.post('/orders', order(THURSDAY));
    expect(yes.status).toBe(200);
    expect(yes.body.orders[0].deliveryMode).toBe('area_days');
    // The same day works for a buyer in a different area only if the round goes there
    const bistro = await as('harbour-bistro').post('/orders', order(THURSDAY)); // Fishguard round: Tuesdays and Fridays
    expect(bistro.status).toBe(409);
    expect((await as('harbour-bistro').post('/orders', order(FRIDAY))).status).toBe(200);
  });

  it('area days: a round can serve a product that is not normally delivered that day', async () => {
    const { as } = await setup({ delivery: 'area_days' });
    // Cheese is a Wednesday product, but Dyfed Dairy drives to the Teifi estuary on Thursdays
    const cheeseListing = 'dyfed-dairy:cheese-cheddar';
    const r = await as('grand-hotel').post('/orders', order(THURSDAY, cheeseListing, 2));
    expect(r.status === 200 || /sold out|no supply|only/.test(r.body.error)).toBe(true);
    expect(r.body.error ?? '').not.toMatch(/delivery round|not delivered on that day/);
  });

  it('hub courier: hub days only, with the hub notice period', async () => {
    const { as, op } = await setup({ delivery: 'hub_courier', hubDays: [2, 4, 6] });
    const bad = await as('corner-deli').post('/orders', order(FRIDAY));
    expect(bad.status).toBe(409);
    expect(bad.body.error).toMatch(/not on a hub courier day/);
    const ok = await as('corner-deli').post('/orders', order(THURSDAY));
    expect(ok.status).toBe(200);
    expect(ok.body.orders[0].deliveryMode).toBe('hub_courier');

    await op.put('/config', { hubDays: [0, 1, 2, 3, 4, 5, 6] });
    const tomorrow = await as('corner-deli').post('/orders', order(addDays(todayIso(), 1)));
    expect(tomorrow.status).toBe(409);
    expect(tomorrow.body.error).toMatch(/more notice/); // milk needs 1 day normally, the hub needs 2
  });

  it('requests and bids are welcome on any day, whatever the delivery model: the producer can offer a different day or a special delivery', async () => {
    const { as, op } = await setup({ delivery: 'hub_courier', hubDays: [2, 4, 6] });
    const friday = addDays(MONDAY, 25);
    const thursday = addDays(MONDAY, 24);
    const hotel = as('grand-hotel');
    // Not a hub day: still accepted
    const first = await hotel.post('/requests', { productId: 'milk-whole', qty: 50, deliveryDate: friday });
    expect(first.status).toBe(200);

    await op.put('/config', { delivery: 'area_days' });
    const id = (await hotel.post('/requests', { productId: 'milk-whole', qty: 50, deliveryDate: friday })).body.request.id;
    // Dyfed Dairy does not drive to Mwnt on a Friday, but may bid: it will be a special delivery
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 50 })).status).toBe(200);
    const id2 = (await hotel.post('/requests', { productId: 'milk-whole', qty: 50, deliveryDate: thursday })).body.request.id;
    expect((await as('dyfed-dairy').post(`/requests/${id2}/bids`, { price: 0.9, qty: 50 })).status).toBe(200);
  });

  it('only the operator can change hub days', async () => {
    const { as } = await setup({});
    expect((await as('dyfed-dairy').put('/config', { hubDays: [1] })).status).toBe(403);
  });
});
