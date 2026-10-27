import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable, session } from '../src/server/db';
import { getConfig, resetSession } from '../src/server/store';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { capabilities, DEFAULT_CONFIG, presetChanges, PRESETS, sanitiseConfig } from '../src/shared/models';
import { SCENARIOS } from '../src/shared/scenarios';
import type { RequestView } from '../src/shared/types';

describe('the demand switch (pure)', () => {
  it('is on by default, and only a true/false is accepted', () => {
    expect(DEFAULT_CONFIG.demandOn).toBe(true);
    expect(sanitiseConfig({ demandOn: false }).demandOn).toBe(false);
    expect(sanitiseConfig({ demandOn: 'no' }).demandOn).toBe(true);
    expect(sanitiseConfig({ demandOn: 0 }).demandOn).toBe(true);
    expect(sanitiseConfig({ demandOn: true }, { ...DEFAULT_CONFIG, demandOn: false }).demandOn).toBe(true);
  });

  it('switches the whole demand board off, whatever the market model', () => {
    expect(capabilities({ ...DEFAULT_CONFIG, market: 'rfq' }).showDemandBoard).toBe(true);
    expect(capabilities({ ...DEFAULT_CONFIG, market: 'catalogue' }).showDemandBoard).toBe(true);
    expect(capabilities({ ...DEFAULT_CONFIG, market: 'rfq', demandOn: false }).showDemandBoard).toBe(false);
    expect(capabilities({ ...DEFAULT_CONFIG, market: 'catalogue', demandOn: false }).showDemandBoard).toBe(false);
    expect(capabilities({ ...DEFAULT_CONFIG, market: 'forward' }).showDemandBoard).toBe(false);
  });

  it('presets leave the demand switch alone, except the one that is about demand', () => {
    for (const p of PRESETS) {
      const changes = presetChanges(p);
      if (p.id === 'demand-led') expect(changes.demandOn).toBe(true);
      else expect('demandOn' in changes).toBe(false);
    }
  });

  it('only the speculative scenario is marked as using demand', () => {
    expect(SCENARIOS.filter((s) => s.usesDemand).map((s) => s.id)).toEqual(['speculative']);
  });
});

const dbUp = await ensureTable().then(() => true, () => false);
let n = 0;
const newSession = () => `dem-${Date.now().toString(36)}-${n++}`;
const DATE = addDays(mondayOf(todayIso()), 24);

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
async function setup() {
  const sid = newSession();
  await who(sid, 'operator').put('/config', { localRange: 'flat', flatRadiusKm: 200 });
  return { sid, op: who(sid, 'operator'), as: (id: string) => who(sid, id) };
}
const ask = (extra = {}) => ({ productId: 'milk-whole', qty: 50, deliveryDate: DATE, ...extra });

describe.skipIf(!dbUp)('with demand requests switched off', () => {
  it('only the operator can flip it', async () => {
    const { as, op } = await setup();
    expect((await as('corner-deli').put('/config', { demandOn: false })).status).toBe(403);
    expect((await op.put('/config', { demandOn: false })).body.demandOn).toBe(false);
    expect((await op.get('/config')).body.demandOn).toBe(false);
  });

  it('nobody can make a request, bid, or take one', async () => {
    const { as, op } = await setup();
    const id = (await as('corner-deli').post('/requests', ask({ targetPrice: 0.9 }))).body.request.id; // made while it was on
    await op.put('/config', { demandOn: false });
    const create = await as('corner-deli').post('/requests', ask());
    expect(create.status).toBe(409);
    expect(create.body.error).toMatch(/switched off/);
    expect((await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.9, qty: 50 })).status).toBe(409);
    await op.put('/config', { speculative: 'first_accept' });
    expect((await as('dyfed-dairy').post(`/requests/${id}/take`)).status).toBe(409);
  });

  it('every screen sees none, but they are kept and come back when it is switched on again', async () => {
    const { as, op } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 50 });
    const count = async (who_: string) => ((await as(who_).get('/requests')).body as RequestView[]).length;
    expect([await count('corner-deli'), await count('dyfed-dairy'), await count('operator')]).toEqual([1, 1, 1]);

    await op.put('/config', { demandOn: false });
    expect([await count('corner-deli'), await count('dyfed-dairy'), await count('operator')]).toEqual([0, 0, 0]);

    await op.put('/config', { demandOn: true });
    const back = (await as('corner-deli').get('/requests')).body as RequestView[];
    expect(back).toHaveLength(1);
    expect(back[0].bids).toHaveLength(1); // the bid survived too
    expect((await as('corner-deli').post('/requests', ask())).status).toBe(200);
  });

  it('orders from earlier accepted bids are ordinary orders and stay', async () => {
    const { as, op } = await setup();
    const id = (await as('corner-deli').post('/requests', ask())).body.request.id;
    await as('dyfed-dairy').post(`/requests/${id}/bids`, { price: 0.95, qty: 50 });
    const bid = ((await as('corner-deli').get('/requests')).body as RequestView[])[0].bids[0];
    await as('corner-deli').post(`/requests/${id}/accept`, { bidId: bid.id });
    await op.put('/config', { demandOn: false });
    const orders = (await as('corner-deli').get('/orders')).body as { source?: { requestId: string }; status: string }[];
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: 'confirmed', source: { requestId: id } });
  });

  it('a session older than the setting reads as on', async () => {
    const sid = newSession();
    await resetSession(sid);
    const { demandOn: _d, ...old } = (await session(sid).get<any>('CONFIG', 'model'))!;
    await session(sid).put('CONFIG', 'model', old);
    expect((await getConfig(session(sid))).demandOn).toBe(true);
  });
});

describe.skipIf(!dbUp)('scenarios and the demand switch', () => {
  it('a scenario that is not about demand leaves it off; one that is switches it on; a reset restores it', async () => {
    const { sid, op } = await setup();
    await op.put('/config', { demandOn: false });

    expect((await op.post('/admin/scenario', { id: 'stock-down' })).status).toBe(200);
    expect((await op.get('/config')).body.demandOn).toBe(false); // the scenario does not touch it
    expect((await op.get('/config')).body.stockTrigger).toBe('on_confirm'); // but everything else is as the scenario says

    expect((await op.post('/admin/scenario', { id: 'forecast-cut' })).status).toBe(200);
    expect((await op.get('/config')).body).toMatchObject({ demandOn: false, stockTrigger: 'on_place' });

    expect((await op.post('/admin/scenario', { id: 'speculative' })).status).toBe(200);
    expect((await op.get('/config')).body.demandOn).toBe(true); // this one needs it

    await op.put('/config', { demandOn: false });
    await op.post('/admin/reset');
    expect((await op.get('/config')).body.demandOn).toBe(true); // "reset to the starting data" means the starting settings
    void sid;
  }, 60_000); // four reseeds in a row: slow when the whole suite shares one database

  it('a scenario started while demand is already on leaves it on', async () => {
    const { op } = await setup();
    await op.post('/admin/scenario', { id: 'short-delivery' });
    expect((await op.get('/config')).body.demandOn).toBe(true);
  });
});
