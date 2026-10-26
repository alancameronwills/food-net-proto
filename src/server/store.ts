import { DEFAULT_CONFIG, sanitiseConfig, type ModelConfig } from '../shared/models';
import type { DriveDistances, Listing, Organisation, SupplyWindow, Category, Product } from '../shared/types';
import { ensureTable, session, type Session } from './db';
import { buildSeed, isoDate } from './seed';

/** Item kinds that make up a demo session; `reset` wipes and reseeds all of them. */
export const KINDS = ['ORG', 'CATEGORY', 'PRODUCT', 'LISTING', 'WINDOW', 'DIST', 'CONFIG', 'META', 'ORDER', 'ACTIVITY', 'NOTIF', 'REQUEST'];

export async function resetSession(id: string, today = isoDate(new Date())): Promise<void> {
  await ensureTable();
  const s = session(id);
  await s.clear(KINDS);
  const seed = buildSeed(today);
  await s.putMany('ORG', seed.orgs.map((o) => ({ sk: o.id, data: o })));
  await s.putMany('CATEGORY', seed.categories.map((c) => ({ sk: c.id, data: c })));
  await s.putMany('PRODUCT', seed.products.map((p) => ({ sk: p.id, data: p })));
  await s.putMany('LISTING', seed.listings.map((l) => ({ sk: l.id, data: l })));
  await s.putMany('WINDOW', seed.windows.map((w) => ({ sk: `${w.listingId}#${w.start}`, data: w })));
  await s.putMany('DIST', Object.entries(seed.distances).map(([from, to]) => ({ sk: from, data: { from, to } })));
  await s.put('CONFIG', 'model', DEFAULT_CONFIG);
  await s.put('META', 'session', { seededOn: today, version: 1 });
}

export async function isSeeded(s: Session): Promise<boolean> {
  return !!(await s.get('META', 'session'));
}

/**
 * Seed a session on first use. Several role-players often open a fresh session at once, so a
 * lock item (kept outside KINDS so `reset` doesn't clear it) lets exactly one request seed
 * while the others wait for it to finish.
 */
export async function ensureSeeded(s: Session): Promise<void> {
  if (await isSeeded(s)) return;
  if (await s.putIfAbsent('LOCK', 'seed', { expires: Date.now() + 30_000 })) {
    try {
      if (!(await isSeeded(s))) await resetSession(s.id);
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

export const getConfig = async (s: Session): Promise<ModelConfig> =>
  (await s.get<ModelConfig>('CONFIG', 'model')) ?? DEFAULT_CONFIG;

export async function updateConfig(s: Session, patch: Record<string, unknown>): Promise<ModelConfig> {
  const next = sanitiseConfig(patch, await getConfig(s));
  await s.put('CONFIG', 'model', next);
  return next;
}

export const listOrgs = (s: Session) => s.list<Organisation>('ORG');
export const listCategories = (s: Session) => s.list<Category>('CATEGORY');
export const listProducts = (s: Session) => s.list<Product>('PRODUCT');
export const listListings = (s: Session) => s.list<Listing>('LISTING');
export const listWindows = (s: Session) => s.list<SupplyWindow>('WINDOW');

export async function getDistances(s: Session): Promise<DriveDistances> {
  const rows = await s.list<{ from: string; to: Record<string, number> }>('DIST');
  return Object.fromEntries(rows.map((r) => [r.from, r.to]));
}
