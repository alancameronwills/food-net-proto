import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable, session } from '../src/server/db';
import { getConfig, resetSession, SEED_VERSION } from '../src/server/store';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';

const dbUp = await ensureTable().then(() => true, () => false);
let n = 0;
const newSession = () => `upg-${Date.now().toString(36)}-${n++}`;
const call = async (sid: string, persona: string, method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method, headers: { 'x-session': sid, 'x-persona': persona, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

/** Make a session look like one created before delivery areas and hub days existed. */
async function makeOld(sid: string) {
  await resetSession(sid);
  const s = session(sid);
  const { hubDays: _h, ...oldConfig } = (await s.get<any>('CONFIG', 'model'))!;
  await s.put('CONFIG', 'model', oldConfig);
  await s.clear(['AREA']);
  for (const o of await s.list<any>('ORG')) {
    const { area: _a, routes: _r, ...rest } = o;
    await s.put('ORG', o.id, rest);
  }
  await s.put('META', 'session', { seededOn: todayIso(), version: 1 });
}

describe.skipIf(!dbUp)('older sessions are upgraded in place', () => {
  it('fills in missing settings, areas and routes, and keeps what people have done', async () => {
    const sid = newSession();
    await makeOld(sid);
    // Something a person did in the old session
    await call(sid, 'operator', 'PUT', '/config', { localRange: 'flat', flatRadiusKm: 200, delivery: 'hub_courier' });
    const date = addDays(mondayOf(todayIso()), 10);
    const placed = await call(sid, 'corner-deli', 'POST', '/orders', { deliveryDate: date, lines: [{ listingId: 'dyfed-dairy:milk-whole', qty: 10 }] });
    await session(sid).put('META', 'session', { seededOn: todayIso(), version: 1 }); // back to "old" after the setup above upgraded it

    const boot = (await call(sid, 'operator', 'GET', '/bootstrap')).body;
    expect(boot.config.hubDays).toEqual([2, 4, 6]);
    expect(boot.config.delivery).toBe('hub_courier'); // their choice survives
    expect(boot.config.localRange).toBe('flat');
    expect(boot.areas.length).toBeGreaterThan(0);
    expect(boot.orgs.every((o: any) => o.area)).toBe(true);
    expect(boot.orgs.find((o: any) => o.id === 'dyfed-dairy').routes.teifi).toBeDefined();
    expect((await session(sid).get<any>('META', 'session'))!.version).toBe(SEED_VERSION);
    if (placed.status === 200) {
      const orders = (await call(sid, 'operator', 'GET', '/orders')).body;
      expect(orders).toHaveLength(1); // not wiped
    }
  });

  it('settings added later never read as missing, even if the stored copy lacks them', async () => {
    const sid = newSession();
    await resetSession(sid);
    const { hubDays: _h, flatRadiusKm: _f, ...old } = (await session(sid).get<any>('CONFIG', 'model'))!;
    await session(sid).put('CONFIG', 'model', old);
    const c = await getConfig(session(sid));
    expect(c.hubDays).toEqual([2, 4, 6]);
    expect(c.flatRadiusKm).toBe(50);
  });

  it('a delivery change on an old session works through the API', async () => {
    const sid = newSession();
    await makeOld(sid);
    const r = await call(sid, 'operator', 'PUT', '/config', { delivery: 'hub_courier' });
    expect(r.status).toBe(200);
    expect(r.body.hubDays).toEqual([2, 4, 6]);
    const day = await call(sid, 'operator', 'PUT', '/config', { hubDays: [1, 3] });
    expect(day.body.hubDays).toEqual([1, 3]);
  });
});
