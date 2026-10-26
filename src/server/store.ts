import { DEFAULT_CONFIG, sanitiseConfig, type ModelConfig } from '../shared/models';
import type { DriveDistances, Listing, Organisation, SupplyWindow, Category, Product } from '../shared/types';
import { ensureTable, session, type Session } from './db';
import { buildSeed, isoDate } from './seed';

/** Item kinds that make up a demo session; `reset` wipes and reseeds all of them. */
export const KINDS = ['ORG', 'CATEGORY', 'PRODUCT', 'LISTING', 'WINDOW', 'DIST', 'CONFIG', 'META'];

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
