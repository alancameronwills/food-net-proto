import { DEFAULT_CONFIG, sanitiseConfig, type ModelConfig } from '../shared/models';
import type { Area, DriveDistances, Listing, Organisation, SupplyWindow, Category, Product } from '../shared/types';
import { ensureTable, session, type Session } from './db';
import { buildSeed, isoDate } from './seed';

/** Item kinds that make up a demo session; `reset` wipes and reseeds all of them. */
export const KINDS = ['ORG', 'CATEGORY', 'PRODUCT', 'LISTING', 'WINDOW', 'DIST', 'CONFIG', 'META', 'ORDER', 'ACTIVITY', 'NOTIF', 'REQUEST', 'AREA'];

/** Bumped whenever the starting data gains something older sessions lack; older sessions are upgraded in place on next use. */
export const SEED_VERSION = 3;

/** A reset that has not finished within this long is assumed to have died, so nobody waits for it for ever. */
const RESET_STALE_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wipe a session and reload the starting data.
 *
 * While this runs the session is marked as being reset, and everyone else's requests wait for it to finish. Without
 * that, screens polling in the middle would find an empty session (and treat the operator as a stranger), and would
 * start a second reload on top of this one. The mark is on the session record itself, which is never deleted during
 * the reset, so there is no moment at which the session looks as if it had never been seeded.
 */
export async function resetSession(id: string, today = isoDate(new Date())): Promise<void> {
  await ensureTable();
  const s = session(id);
  // One reset at a time (a double click, a scenario started as someone resets)
  for (let tries = 0; !(await s.putIfAbsent('LOCK', 'reset', { expires: Date.now() + RESET_STALE_MS })); tries++) {
    if (tries > 300) throw new Error('Another reset of this session is taking too long');
    await sleep(100);
  }
  try {
    await s.put('META', 'session', { seededOn: today, version: SEED_VERSION, resetting: true, since: Date.now() });
    await s.clear(KINDS, { META: 'session' }); // everything, except the record that says "reset in progress"
    const seed = buildSeed(today);
    await s.putMany('ORG', seed.orgs.map((o) => ({ sk: o.id, data: o })));
    await s.putMany('AREA', seed.areas.map((a) => ({ sk: a.id, data: a })));
    await s.putMany('CATEGORY', seed.categories.map((c) => ({ sk: c.id, data: c })));
    await s.putMany('PRODUCT', seed.products.map((p) => ({ sk: p.id, data: p })));
    await s.putMany('LISTING', seed.listings.map((l) => ({ sk: l.id, data: l })));
    await s.putMany('WINDOW', seed.windows.map((w) => ({ sk: `${w.listingId}#${w.start}`, data: w })));
    await s.putMany('DIST', Object.entries(seed.distances).map(([from, to]) => ({ sk: from, data: { from, to } })));
    await s.put('CONFIG', 'model', DEFAULT_CONFIG);
    await s.put('META', 'session', { seededOn: today, version: SEED_VERSION }); // done: no longer "resetting"
  } finally {
    await s.remove('LOCK', 'reset');
  }
}

type SessionMeta = { seededOn?: string; version?: number; resetting?: boolean; since?: number };
const readMeta = (s: Session) => s.get<SessionMeta>('META', 'session');

/** Seeded, and not in the middle of being reset (a reset that has gone quiet for a minute is taken to have died). */
const isReady = (m: SessionMeta | undefined): boolean => !!m && !(m.resetting && Date.now() - (m.since ?? 0) < RESET_STALE_MS);

export async function isSeeded(s: Session): Promise<boolean> {
  return isReady(await readMeta(s));
}

/**
 * Seed a session on first use. Several role-players often open a fresh session at once, so a
 * lock item (kept outside KINDS so `reset` doesn't clear it) lets exactly one request seed
 * while the others wait for it to finish.
 */
export async function ensureSeeded(s: Session): Promise<void> {
  const meta = await readMeta(s);
  if (meta) {
    // Someone is resetting this session: wait for it to finish rather than see it half-empty
    if (!isReady(meta)) {
      for (let i = 0; i < 200 && !isReady(await readMeta(s)); i++) await sleep(50);
      return;
    }
    if ((meta.version ?? 1) < SEED_VERSION) await upgradeSession(s, meta.seededOn);
    return;
  }
  if (await s.putIfAbsent('LOCK', 'seed', { expires: Date.now() + 30_000 })) {
    try {
      if (!(await readMeta(s))) await resetSession(s.id); // (not if a reset has already begun: that one will finish the job)
    } finally {
      await s.remove('LOCK', 'seed');
    }
    return;
  }
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isSeeded(s)) return;
  }
  throw new Error('Session seeding timed out');
}

/** Stored settings laid over the current defaults, so a setting added later never reads as missing. */
export const getConfig = async (s: Session): Promise<ModelConfig> => {
  const stored = await s.get<Partial<ModelConfig>>('CONFIG', 'model');
  return sanitiseConfig({ ...stored }, { ...DEFAULT_CONFIG, ...stored });
};

/**
 * Bring an older session up to date without touching its orders, requests, stock or listings: refresh the reference
 * data that comes from the data files (organisations, areas, categories, distances) and complete the model settings.
 * Safe to run twice at once.
 */
export async function upgradeSession(s: Session, seededOn = isoDate(new Date())): Promise<void> {
  const seed = buildSeed(seededOn);
  await s.putMany('ORG', seed.orgs.map((o) => ({ sk: o.id, data: o })));
  await s.putMany('AREA', seed.areas.map((a) => ({ sk: a.id, data: a })));
  await s.putMany('CATEGORY', seed.categories.map((c) => ({ sk: c.id, data: c })));
  await s.putMany('DIST', Object.entries(seed.distances).map(([from, to]) => ({ sk: from, data: { from, to } })));
  await s.put('CONFIG', 'model', await getConfig(s));
  await s.put('META', 'session', { seededOn, version: SEED_VERSION });
}

export async function updateConfig(s: Session, patch: Record<string, unknown>): Promise<ModelConfig> {
  const next = sanitiseConfig(patch, await getConfig(s));
  await s.put('CONFIG', 'model', next);
  return next;
}

export const listOrgs = (s: Session) => s.list<Organisation>('ORG');
export const listAreas = (s: Session) => s.list<Area>('AREA');
export const listCategories = (s: Session) => s.list<Category>('CATEGORY');
export const listProducts = (s: Session) => s.list<Product>('PRODUCT');
export const listListings = (s: Session) => s.list<Listing>('LISTING');
export const listWindows = (s: Session) => s.list<SupplyWindow>('WINDOW');

export async function getDistances(s: Session): Promise<DriveDistances> {
  const rows = await s.list<{ from: string; to: Record<string, number> }>('DIST');
  return Object.fromEntries(rows.map((r) => [r.from, r.to]));
}
