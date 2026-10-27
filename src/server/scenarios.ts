import { addDays, mondayOf, todayIso } from '../shared/dates';
import { DEFAULT_CONFIG, sanitiseConfig, type ModelConfig } from '../shared/models';
import { scenarioById, type Scenario } from '../shared/scenarios';
import type { Organisation } from '../shared/types';
import type { Session } from './db';
import { placeOrders } from './orders';
import type { Result } from './producer';
import { upsertWindow } from './producer';
import { getConfig, resetSession } from './store';

const fail = (status: 400 | 403 | 404 | 409, error: string): Result<never> => ({ ok: false, status, error });

export type ActiveScenario = { id: string; startedAt: string };

export async function activeScenario(s: Session): Promise<ActiveScenario | null> {
  return (await s.get<ActiveScenario>('META', 'scenario')) ?? null;
}

/** Pre-arranged situations. These run while the local range is relaxed, so any buyer can take part, then the real settings are applied. */
const SETUP: Record<string, (s: Session, actor: (id: string) => Promise<Organisation>) => Promise<void>> = {
  'forecast-cut': async (s, actor) => {
    const week = addDays(mondayOf(todayIso()), 14);
    const dairy = await actor('dyfed-dairy');
    await upsertWindow(s, dairy, { listingId: 'dyfed-dairy:milk-whole', start: week, qtyTotal: 100, confidence: 'forecast' });
    for (const buyer of ['corner-deli', 'castle-caterers']) {
      const r = await placeOrders(s, await actor(buyer), { deliveryDate: addDays(week, 3), lines: [{ listingId: 'dyfed-dairy:milk-whole', qty: 40 }] });
      if (!r.ok) throw new Error(`Scenario setup failed: ${r.error}`);
    }
  },
  'short-delivery': async (s, actor) => {
    const date = addDays(mondayOf(todayIso()), 10); // a Thursday next week
    const r = await placeOrders(s, await actor('corner-deli'), { deliveryDate: date, lines: [{ listingId: 'dyfed-dairy:milk-whole', qty: 40 }] });
    if (!r.ok) throw new Error(`Scenario setup failed: ${r.error}`);
  },
};

export async function startScenario(s: Session, actor: Organisation | undefined, id: unknown): Promise<Result<{ scenario: ActiveScenario }>> {
  if (actor?.role !== 'operator') return fail(403, 'Only the network operator can start a scenario');
  const scenario: Scenario | undefined = typeof id === 'string' ? scenarioById(id) : undefined;
  if (!scenario) return fail(404, 'Unknown scenario');
  if (!scenario.available) return fail(409, scenario.unavailableReason?.en ?? 'This scenario is not available yet');

  // A scenario starts from the standard settings, but it should not undo the operator's choice to keep demand requests
  // off unless the scenario is about them, in which case they come back on
  const demandWasOn = (await getConfig(s)).demandOn;
  await resetSession(s.id);
  const finalConfig: ModelConfig = { ...sanitiseConfig(scenario.config, DEFAULT_CONFIG), demandOn: scenario.usesDemand ? true : demandWasOn };
  const setup = SETUP[scenario.id];
  if (setup) {
    await s.put('CONFIG', 'model', { ...finalConfig, localRange: 'warn' });
    const orgs = new Map((await s.list<Organisation>('ORG')).map((o) => [o.id, o]));
    await setup(s, async (orgId) => orgs.get(orgId)!);
  }
  await s.put('CONFIG', 'model', finalConfig);
  // Anything the setup did happened before this moment, so it does not count towards the steps
  await new Promise((r) => setTimeout(r, 5));
  const active: ActiveScenario = { id: scenario.id, startedAt: new Date().toISOString() };
  await s.put('META', 'scenario', active);
  return { ok: true, scenario: active };
}

export async function endScenario(s: Session, actor: Organisation | undefined): Promise<Result> {
  if (actor?.role !== 'operator') return fail(403, 'Only the network operator can end a scenario');
  await s.remove('META', 'scenario');
  return { ok: true };
}
