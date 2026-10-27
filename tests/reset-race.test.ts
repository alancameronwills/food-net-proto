import '../src/server/env-local';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable } from '../src/server/db';

const dbUp = await ensureTable().then(() => true, () => false);
let n = 0;
const newSession = () => `race-${Date.now().toString(36)}-${n++}`;

async function call(sid: string, persona: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method, headers: { 'x-session': sid, 'x-persona': persona, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe.skipIf(!dbUp)('people using a session while it is being reset', () => {
  /** Poll as the screens do, while a reset (or scenario start) is under way. */
  async function pollDuring(sid: string, action: () => Promise<unknown>) {
    const results: { path: string; status: number; count?: number }[] = [];
    let running = true;
    const poller = (async () => {
      while (running) {
        const [cfg, personas, me] = await Promise.all([
          call(sid, 'operator', 'GET', '/config'),
          call(sid, 'operator', 'GET', '/personas'),
          call(sid, 'corner-deli', 'GET', '/me'),
        ]);
        results.push({ path: 'config', status: cfg.status }, { path: 'personas', status: personas.status, count: personas.body.length }, { path: 'me', status: me.status });
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    await new Promise((r) => setTimeout(r, 30));
    await action();
    await new Promise((r) => setTimeout(r, 30));
    running = false;
    await poller;
    return results;
  }

  it('never sees a half-empty session, and is not thrown out as a stranger', async () => {
    const sid = newSession();
    await call(sid, 'operator', 'GET', '/config'); // seeds it
    const results = await pollDuring(sid, async () => { await call(sid, 'operator', 'POST', '/admin/reset'); });
    expect(results.length).toBeGreaterThanOrEqual(6); // polls that arrive during the reset wait for it, so there are fewer of them
    expect(results.filter((r) => r.path === 'config').map((r) => r.status)).not.toContain(403); // "Operator only" because the operator was not found
    expect(results.filter((r) => r.path === 'me').map((r) => r.status)).not.toContain(404);
    expect(results.filter((r) => r.path === 'personas').every((r) => (r.count ?? 0) >= 3)).toBe(true);
  }, 60_000);

  it('many people opening a brand-new session at the same moment all see it fully loaded', async () => {
    const sid = newSession();
    const first = await Promise.all(Array.from({ length: 12 }, (_, i) => call(sid, i % 2 ? 'operator' : 'corner-deli', 'GET', '/bootstrap')));
    expect(first.map((r) => r.status)).toEqual(Array(12).fill(200));
    for (const r of first) {
      expect(r.body.orgs.length).toBeGreaterThanOrEqual(12); // never a session that is still being filled
      expect(r.body.listings.length).toBeGreaterThan(20);
      expect(r.body.areas.length).toBeGreaterThan(0);
    }
    expect((await call(sid, 'operator', 'GET', '/config')).status).toBe(200); // and the operator is recognised straight away
  }, 60_000);

  it('a scenario started while others are polling keeps its settings and its checklist', async () => {
    const sid = newSession();
    await call(sid, 'operator', 'GET', '/config');
    await call(sid, 'operator', 'PUT', '/config', { demandOn: false });
    const results = await pollDuring(sid, async () => {
      const r = await call(sid, 'operator', 'POST', '/admin/scenario', { id: 'forecast-cut' });
      expect(r.status).toBe(200);
    });
    expect(results.filter((r) => r.path === 'config').map((r) => r.status)).not.toContain(403);
    // Whatever the pollers did, the scenario's own settings and record are what is left
    expect((await call(sid, 'operator', 'GET', '/config')).body).toMatchObject({ stockTrigger: 'on_place', forecastOrdering: 'full_forecast', demandOn: false });
    expect((await call(sid, 'operator', 'GET', '/scenario')).body.active).toMatchObject({ id: 'forecast-cut' });
    expect(((await call(sid, 'operator', 'GET', '/orders')).body as unknown[]).length).toBe(2); // the two waiting orders were not wiped by a second reseed
  }, 60_000);
});
