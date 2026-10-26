import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { SCENARIOS, scenarioById, stepStates } from '../src/shared/scenarios';
import { buildSeed } from '../src/server/seed';
import type { Order } from '../src/shared/types';

const seed = buildSeed(todayIso());
const orgIds = new Set(seed.orgs.map((o) => o.id));

describe('scenario definitions', () => {
  it('have unique ids, bilingual text, and real organisations to play', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      expect(s.title.en && s.title.cy && s.summary.en && s.summary.cy).toBeTruthy();
      for (const step of s.steps) {
        expect(step.text.en && step.text.cy).toBeTruthy();
        expect(step.who === 'operator' || orgIds.has(step.who)).toBe(true);
      }
      if (s.available) expect(s.steps.length).toBeGreaterThan(0);
      else expect(s.unavailableReason?.en).toBeTruthy();
    }
  });

  it('only settings the model lab knows about', () => {
    for (const s of SCENARIOS) {
      for (const k of Object.keys(s.config)) expect(['market', 'operator', 'delivery', 'stockTrigger', 'forecastOrdering', 'speculative', 'pricing', 'localRange', 'trust', 'forecastPct', 'flatRadiusKm', 'hubDays']).toContain(k);
    }
  });

  it('steps tick from events, or by hand', () => {
    const s = scenarioById('speculative')!;
    expect(stepStates(s, [], new Set())).toEqual([false, false, false, false]);
    const events = [{ type: 'request_new' }, { type: 'bid_placed' }];
    expect(stepStates(s, events, new Set())).toEqual([true, true, false, false]); // the third step wants two bids
    expect(stepStates(s, [...events, { type: 'bid_placed' }, { type: 'bid_accepted' }], new Set())).toEqual([true, true, true, true]);
    const manual = scenarioById('plan-menu')!;
    expect(stepStates(manual, [], new Set([0, 1]))).toEqual([true, true, false]);
  });
});

const dbUp = await ensureTable().then(() => true, () => false);
let n = 0;
const newSession = () => `scn-${Date.now().toString(36)}-${n++}`;

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
const MILK = 'dyfed-dairy:milk-whole';

describe.skipIf(!dbUp)('starting scenarios', () => {
  it('only the operator, only known and available scenarios', async () => {
    const sid = newSession();
    expect((await who(sid, 'corner-deli').post('/admin/scenario', { id: 'stock-down' })).status).toBe(403);
    expect((await who(sid, 'operator').post('/admin/scenario', { id: 'nope' })).status).toBe(404);
    const standing = await who(sid, 'operator').post('/admin/scenario', { id: 'standing-order' });
    expect(standing.status).toBe(409);
    expect(standing.body.error).toMatch(/not built yet/);
    expect((await who(sid, 'operator').get('/scenario')).body.active).toBeNull();
  });

  it('resets the session, applies the settings and records what is running', async () => {
    const sid = newSession();
    const op = who(sid, 'operator');
    await op.put('/config', { localRange: 'flat', flatRadiusKm: 200, stockTrigger: 'on_place' });
    await who(sid, 'corner-deli').post('/orders', { deliveryDate: addDays(mondayOf(todayIso()), 10), lines: [{ listingId: MILK, qty: 10 }] });
    expect(((await op.get('/orders')).body as Order[]).length).toBe(1);

    const r = await op.post('/admin/scenario', { id: 'speculative' });
    expect(r.status).toBe(200);
    expect((await op.get('/scenario')).body.active).toMatchObject({ id: 'speculative', startedAt: r.body.scenario.startedAt });
    expect(((await op.get('/orders')).body as Order[]).length).toBe(0); // the earlier order is gone
    const config = (await op.get('/config')).body;
    expect(config).toMatchObject({ speculative: 'open_rfq', stockTrigger: 'on_confirm', localRange: 'per_category' }); // defaults plus the scenario's own settings

    expect((await who(sid, 'corner-deli').post('/admin/scenario', {})).status).toBe(403);
    expect((await who(sid, 'corner-deli').del('/admin/scenario')).status).toBe(403);
    expect((await op.del('/admin/scenario')).status).toBe(200);
    expect((await op.get('/scenario')).body.active).toBeNull();
  });

  it('an ordinary reset ends the scenario', async () => {
    const sid = newSession();
    const op = who(sid, 'operator');
    await op.post('/admin/scenario', { id: 'stock-down' });
    await op.post('/admin/reset');
    expect((await op.get('/scenario')).body.active).toBeNull();
  });

  it('forecast-cut: the orders are waiting, and cutting the forecast flags them', async () => {
    const sid = newSession();
    const op = who(sid, 'operator');
    const started = await op.post('/admin/scenario', { id: 'forecast-cut' });
    expect(started.status).toBe(200);
    const orders = (await op.get('/orders')).body as Order[];
    expect(orders.map((o) => o.buyerId).sort()).toEqual(['castle-caterers', 'corner-deli']);
    expect(orders.every((o) => o.status === 'confirmed' && o.stock === 'reserved')).toBe(true);
    expect((await op.get('/config')).body).toMatchObject({ stockTrigger: 'on_place', forecastOrdering: 'full_forecast', localRange: 'per_category' });

    // The set-up itself must not count as the audience's progress
    const before = ((await op.get('/activity')).body as { at: string; type: string }[]).filter((e) => e.at >= started.body.scenario.startedAt);
    expect(before).toHaveLength(0);

    const week = addDays(mondayOf(todayIso()), 14);
    const cut = await who(sid, 'dyfed-dairy').put('/windows', { listingId: MILK, start: week, qtyTotal: 100, confidence: 'provisional' });
    expect(cut.body.flagged).toBe(2);
    const after = ((await op.get('/activity')).body as { at: string; type: string }[]).filter((e) => e.at >= started.body.scenario.startedAt);
    expect(stepStates(scenarioById('forecast-cut')!, after, new Set())[0]).toBe(true);
  });

  it('short-delivery: an order is waiting for the producer to deliver short', async () => {
    const sid = newSession();
    const op = who(sid, 'operator');
    const started = await op.post('/admin/scenario', { id: 'short-delivery' });
    const [order] = (await op.get('/orders')).body as Order[];
    expect(order).toMatchObject({ buyerId: 'corner-deli', producerId: 'dyfed-dairy', status: 'confirmed' });
    const done = await who(sid, 'dyfed-dairy').post(`/orders/${order.id}/deliver`, { lines: [{ listingId: MILK, qty: 25 }] });
    expect(done.body.order.status).toBe('short');
    const events = ((await op.get('/activity')).body as { at: string; type: string }[]).filter((e) => e.at >= started.body.scenario.startedAt);
    expect(stepStates(scenarioById('short-delivery')!, events, new Set())[0]).toBe(true);
  });
});

describe.skipIf(!dbUp)('feedback', () => {
  it('is stored with the screen and the model in force, and only the operator can read it', async () => {
    const sid = newSession();
    await who(sid, 'operator').put('/config', { delivery: 'hub_courier', trust: 'badges' });
    const r = await who(sid, 'corner-deli').post('/feedback', { text: '  Would prefer weekly invoices  ', screen: 'Basket', mood: 'down' });
    expect(r.status).toBe(200);
    expect(r.body.feedback).toMatchObject({ text: 'Would prefer weekly invoices', screen: 'Basket', mood: 'down', who: { id: 'corner-deli', name: 'Corner Deli', role: 'buyer' } });
    expect(r.body.feedback.config).toMatchObject({ delivery: 'hub_courier', trust: 'badges' });
    expect(r.body.feedback.scenario).toBeUndefined();

    expect((await who(sid, 'corner-deli').get('/feedback')).status).toBe(403);
    const list = (await who(sid, 'operator').get('/feedback')).body.items;
    expect(list).toHaveLength(1);
    expect((await who(sid, 'dyfed-dairy').del('/feedback')).status).toBe(403);
  });

  it('records which scenario was running, and survives a reset', async () => {
    const sid = newSession();
    const op = who(sid, 'operator');
    await op.post('/admin/scenario', { id: 'stock-down' });
    await who(sid, 'dyfed-dairy').post('/feedback', { text: 'Clear enough', screen: 'Stock & forecast', mood: 'up' });
    await op.post('/admin/reset');
    const items = (await op.get('/feedback')).body.items;
    expect(items).toHaveLength(1);
    expect(items[0].scenario).toBe('stock-down');
    expect((await op.del('/feedback')).status).toBe(200);
    expect((await op.get('/feedback')).body.items).toHaveLength(0);
  });

  it('validates comments', async () => {
    const sid = newSession();
    const b = who(sid, 'corner-deli');
    expect((await b.post('/feedback', { text: '   ' })).status).toBe(400);
    expect((await b.post('/feedback', { text: 'x'.repeat(1001) })).status).toBe(400);
    expect((await who(sid, 'nobody').post('/feedback', { text: 'hello' })).status).toBe(403); // no role chosen
    const ok = await b.post('/feedback', { text: 'fine', mood: 'sideways', screen: 'y'.repeat(200) });
    expect(ok.body.feedback.mood).toBeUndefined();
    expect(ok.body.feedback.screen).toHaveLength(80);
  });
});
