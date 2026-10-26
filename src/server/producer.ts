import { addDays, isIsoDate, isMonday, mondayOf, todayIso } from '../shared/dates';
import type { Confidence, Listing, Organisation, SupplyWindow } from '../shared/types';
import type { Session } from './db';
import { listProducts } from './store';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: 400 | 403 | 404 | 409; error: string };
const fail = (status: 400 | 403 | 404 | 409, error: string): Result<never> => ({ ok: false, status, error });

export const CONFIDENCES: Confidence[] = ['in_stock', 'forecast', 'provisional'];
const MAX_QTY = 100_000;
/** Windows may start from last week up to ~6 months ahead. */
const MAX_WEEKS_AHEAD = 26;

export const winSk = (listingId: string, start: string) => `${listingId}#${start}`;

const isQty = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_QTY;
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 10_000;

/** Producers manage their own listings; the operator may manage any (handy when presenting). */
function canManage(actor: Organisation | undefined, producerId: string): boolean {
  return !!actor && (actor.role === 'operator' || (actor.role === 'producer' && actor.id === producerId));
}

async function ownedListing(s: Session, actor: Organisation | undefined, listingId: unknown): Promise<Result<{ listing: Listing }>> {
  if (typeof listingId !== 'string') return fail(400, 'listingId required');
  const listing = await s.get<Listing>('LISTING', listingId);
  if (!listing) return fail(404, 'Unknown listing');
  if (!canManage(actor, listing.producerId)) return fail(403, 'You can only edit your own listings');
  return { ok: true, listing };
}

function cleanTiers(tiers: unknown, minOrder: number, price: number): Result<{ tiers: Listing['tiers'] }> {
  if (tiers === undefined || tiers === null) return { ok: true, tiers: undefined };
  if (!Array.isArray(tiers) || tiers.length > 3) return fail(400, 'tiers must be a list of up to 3 entries');
  const out: { minQty: number; price: number }[] = [];
  let prevQty = minOrder;
  let prevPrice = price;
  for (const t of [...tiers].sort((a, b) => a?.minQty - b?.minQty)) {
    if (!t || !isQty(t.minQty) || t.minQty <= prevQty || !isMoney(t.price) || t.price >= prevPrice) {
      return fail(400, 'Each tier needs a larger minimum quantity and a lower price than the one before');
    }
    out.push({ minQty: t.minQty, price: t.price });
    prevQty = t.minQty;
    prevPrice = t.price;
  }
  return { ok: true, tiers: out.length ? out : undefined };
}

export async function addListing(s: Session, actor: Organisation | undefined, body: Record<string, any>): Promise<Result<{ listing: Listing }>> {
  if (!actor || (actor.role !== 'producer' && actor.role !== 'operator')) return fail(403, 'Only producers can add listings');
  const producerId = actor.role === 'operator' ? body.producerId : actor.id;
  const producer = typeof producerId === 'string' ? await s.get<Organisation>('ORG', producerId) : undefined;
  if (!producer || producer.role !== 'producer') return fail(400, 'Unknown producer');
  const product = (await listProducts(s)).find((p) => p.id === body.productId);
  if (!product) return fail(400, 'Unknown product');
  if (!isMoney(body.pricePerUnit)) return fail(400, 'pricePerUnit must be a positive number');
  if (!isMoney(body.minOrder)) return fail(400, 'minOrder must be a positive number');
  const tiers = cleanTiers(body.tiers, body.minOrder, body.pricePerUnit);
  if (!tiers.ok) return tiers;
  const listing: Listing = {
    id: `${producer.id}:${product.id}`, producerId: producer.id, productId: product.id,
    pricePerUnit: body.pricePerUnit, minOrder: body.minOrder, certifications: [], tiers: tiers.tiers,
  };
  if (!(await s.create('LISTING', listing.id, listing))) return fail(409, 'You already list this product');
  return { ok: true, listing };
}

export async function updateListing(s: Session, actor: Organisation | undefined, id: string, body: Record<string, any>): Promise<Result<{ listing: Listing }>> {
  const got = await ownedListing(s, actor, id);
  if (!got.ok) return got;
  const price = body.pricePerUnit ?? got.listing.pricePerUnit;
  const minOrder = body.minOrder ?? got.listing.minOrder;
  if (!isMoney(price)) return fail(400, 'pricePerUnit must be a positive number');
  if (!isMoney(minOrder)) return fail(400, 'minOrder must be a positive number');
  const tiers = cleanTiers('tiers' in body ? body.tiers : got.listing.tiers, minOrder, price);
  if (!tiers.ok) return tiers;
  const listing: Listing = { ...got.listing, pricePerUnit: price, minOrder, tiers: tiers.tiers };
  await s.put('LISTING', id, listing);
  return { ok: true, listing };
}

export async function removeListing(s: Session, actor: Organisation | undefined, id: string): Promise<Result> {
  const got = await ownedListing(s, actor, id);
  if (!got.ok) return got;
  const windows = await s.list<SupplyWindow>('WINDOW', `${id}#`);
  if (windows.some((w) => w.qtyReserved > 0)) return fail(409, 'This listing has reserved stock, so it cannot be removed');
  for (const w of windows) await s.remove('WINDOW', winSk(id, w.start));
  await s.remove('LISTING', id);
  return { ok: true };
}

function checkWeek(start: unknown): Result<{ start: string }> {
  if (!isIsoDate(start) || !isMonday(start)) return fail(400, 'start must be a Monday (YYYY-MM-DD)');
  const first = addDays(mondayOf(todayIso()), -7);
  const last = addDays(mondayOf(todayIso()), MAX_WEEKS_AHEAD * 7);
  if (start < first || start > last) return fail(400, `start must be between ${first} and ${last}`);
  return { ok: true, start };
}

/** Set (or create) one week's supply. Quantity can never drop below what buyers have already reserved. */
export async function upsertWindow(s: Session, actor: Organisation | undefined, body: Record<string, any>): Promise<Result<{ window: SupplyWindow }>> {
  const got = await ownedListing(s, actor, body.listingId);
  if (!got.ok) return got;
  const week = checkWeek(body.start);
  if (!week.ok) return week;
  if (!isQty(body.qtyTotal)) return fail(400, `qtyTotal must be a whole number from 0 to ${MAX_QTY}`);
  if (!CONFIDENCES.includes(body.confidence)) return fail(400, 'confidence must be in_stock, forecast or provisional');

  const sk = winSk(got.listing.id, week.start);
  const updated = await s.updateIf('WINDOW', sk, { qtyTotal: body.qtyTotal, confidence: body.confidence },
    'attribute_exists(pk) AND #qtyReserved <= :q', { ':q': body.qtyTotal });
  if (!updated) {
    const existing = await s.get<SupplyWindow>('WINDOW', sk);
    if (existing) return fail(409, `${existing.qtyReserved} already reserved by buyers; quantity cannot go below that`);
    const fresh: SupplyWindow = {
      listingId: got.listing.id, start: week.start, end: addDays(week.start, 6),
      qtyTotal: body.qtyTotal, qtyReserved: 0, confidence: body.confidence,
    };
    if (!(await s.create('WINDOW', sk, fresh))) return fail(409, 'Someone changed this week at the same time; please retry');
  }
  return { ok: true, window: (await s.get<SupplyWindow>('WINDOW', sk))! };
}

/** Add `weeks` weeks of supply starting at `from`, skipping weeks that already exist. */
export async function addWeeks(s: Session, actor: Organisation | undefined, body: Record<string, any>): Promise<Result<{ created: number }>> {
  const got = await ownedListing(s, actor, body.listingId);
  if (!got.ok) return got;
  const first = checkWeek(body.from);
  if (!first.ok) return first;
  if (!Number.isInteger(body.weeks) || body.weeks < 1 || body.weeks > 12) return fail(400, 'weeks must be 1 to 12');
  if (!isQty(body.qtyTotal) || !CONFIDENCES.includes(body.confidence)) return fail(400, 'qtyTotal and confidence required');
  let created = 0;
  for (let i = 0; i < body.weeks; i++) {
    const start = addDays(first.start, i * 7);
    if (checkWeek(start).ok === false) break;
    const w: SupplyWindow = {
      listingId: got.listing.id, start, end: addDays(start, 6), qtyTotal: body.qtyTotal, qtyReserved: 0, confidence: body.confidence,
    };
    if (await s.create('WINDOW', winSk(got.listing.id, start), w)) created++;
  }
  return { ok: true, created };
}

export async function removeWindow(s: Session, actor: Organisation | undefined, listingId: string, start: string): Promise<Result> {
  const got = await ownedListing(s, actor, listingId);
  if (!got.ok) return got;
  const sk = winSk(listingId, start);
  const existing = await s.get<SupplyWindow>('WINDOW', sk);
  if (!existing) return fail(404, 'No such week');
  const done = await s.removeIf('WINDOW', sk, '#qtyReserved = :zero', { '#qtyReserved': 'qtyReserved' }, { ':zero': 0 });
  return done ? { ok: true } : fail(409, 'Buyers have reserved stock in this week, so it cannot be removed');
}
