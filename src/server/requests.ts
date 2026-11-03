import { addDays, isIsoDate, mondayOf, todayIso } from '../shared/dates';
import { localStatus } from '../shared/models';
import { MAX_DAYS_AHEAD, deliveryRule, isUsualDay } from '../shared/delivery';
import { OTHER_PRODUCT, type Bid, type Category, type DemandRequest, type Listing, type Order, type Organisation, type RequestView, type SupplyWindow } from '../shared/types';
import type { Session, TxItem } from './db';
import { emit, type EventParams, type EventType } from './events';
import type { Result } from './producer';
import { getConfig, getDistances, listCategories, listProducts } from './store';

const fail = (status: 400 | 403 | 404 | 409, error: string): Result<never> => ({ ok: false, status, error });
const RETRIES = 4;
const MAX_QTY = 100_000;
const rand = () => Math.random().toString(36).slice(2, 6);
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 10_000;
const isQty = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_QTY;

async function load(s: Session, known?: Awaited<ReturnType<typeof getConfig>>) {
  const [config, categories, products, distances] = await Promise.all([known ?? getConfig(s), listCategories(s), listProducts(s), getDistances(s)]);
  return {
    config, distances,
    categories: new Map(categories.map((c) => [c.id, c])),
    products: new Map(products.map((p) => [p.id, p])),
  };
}
type Ctx = Awaited<ReturnType<typeof load>>;

/** Can this producer take part in a buyer's request, under the local-range model? */
function inRange(ctx: Ctx, buyerId: string, producerId: string, category: Category | undefined): boolean {
  if (!category) return false; // no category to judge by: nobody is in range
  const km = ctx.distances[buyerId]?.[producerId];
  return km !== undefined && localStatus(ctx.config, category.maxDriveKm, km) !== 'hidden';
}

const remaining = (r: DemandRequest) => r.qty - r.filledQty;
const OFF = 'Demand requests are switched off. The network operator can switch them on in the Model Lab.';

// Requests for something else never pool: they are not the same thing
const poolKey = (r: Pick<DemandRequest, 'id' | 'productId' | 'deliveryDate'>) => `${r.productId === OTHER_PRODUCT ? r.id : r.productId}#${mondayOf(r.deliveryDate)}`;

/** The category whose local range applies. For something else (no category) the widest range, so every producer who might help can see it. */
function categoryOf(ctx: Ctx, productId: string): Category | undefined {
  const product = ctx.products.get(productId);
  const known = product && ctx.categories.get(product.category);
  if (known) return known;
  const all = [...ctx.categories.values()];
  return all.length ? all.reduce((a, b) => (b.maxDriveKm > a.maxDriveKm ? b : a)) : undefined; // undefined: the session has no categories
}
const NO_CATEGORIES = 'No product categories are set up for this session, so requests cannot be matched to producers. The operator can reset the session.';

/** A delivery day that is not in the future can no longer be met, however long the request or bid has been open. */
const PASSED = 'The delivery day for this request has passed, so it can no longer be bid on or accepted. The buyer can withdraw it and ask again for a new day.';
const BID_DAY_PASSED = 'The delivery day this bid offered has passed, so it cannot be accepted. The producer can send the bid again with a new day.';

/** Notifying people comes after the change is made: if it fails, the change still stands, so it is logged and not raised. */
async function quietly(what: string, f: () => Promise<unknown>): Promise<void> {
  try { await f(); } catch (e) { console.error(`${what} failed`, e); }
}

async function say(s: Session, type: EventType, r: DemandRequest, extra: EventParams, to: string[]) {
  try {
    const buyer = await s.get<Organisation>('ORG', r.buyerId);
    await emit(s, type, { requestId: r.id, buyer: buyer?.name, productId: r.productId, qty: r.qty, date: r.deliveryDate, ...extra }, to);
  } catch (e) {
    console.error('say failed', e);
  }
}
const orgName = async (s: Session, id: string) => (await s.get<Organisation>('ORG', id))?.name;

// ---- reading ---------------------------------------------------------------------------------

/** Requests as the asking organisation may see them. Producers see only their own bids (bidding is sealed). */
export async function listRequests(s: Session, actor: Organisation | undefined): Promise<RequestView[]> {
  if (!actor) return [];
  const config = await getConfig(s);
  if (!config.demandOn) return []; // kept, but out of sight until switched back on (and cheap to say so)
  return viewsFor(s, actor, await load(s, config));
}

/**
 * One request, as the actor sees it, after something changed it. Always included, and shown even if demand was switched off a moment ago.
 * The change has already happened, so a failure here must not turn it into an error: the reply just leaves the request out.
 */
async function viewOf(s: Session, actor: Organisation | undefined, id: string, ctx?: Ctx): Promise<RequestView | undefined> {
  if (!actor) return undefined;
  try {
    return (await viewsFor(s, actor, ctx ?? await load(s), id)).find((r) => r.id === id);
  } catch (e) {
    console.error('view after a change failed', e);
    return undefined;
  }
}

/** An open request whose delivery day has gone can no longer be met: it stays for the buyer to close, but is out of the pools and producers' lists. */
const expired = (r: DemandRequest) => r.status === 'open' && r.deliveryDate <= todayIso();

async function viewsFor(s: Session, actor: Organisation, ctx: Ctx, forceId?: string): Promise<RequestView[]> {
  const all = await s.list<DemandRequest>('REQUEST');
  const catOf = (r: DemandRequest) => categoryOf(ctx, r.productId);

  // A pool counts only what the viewer could take part in: a producer's totals leave out buyers beyond their range
  const pools = new Map<string, { totalQty: number; requests: number; buyers: Set<string> }>();
  if (ctx.config.speculative === 'pooled') {
    const counts = (x: DemandRequest) => x.status === 'open' && !expired(x) && (actor.role !== 'producer' || inRange(ctx, x.buyerId, actor.id, catOf(x)));
    for (const r of all.filter(counts)) {
      const p = pools.get(poolKey(r)) ?? { totalQty: 0, requests: 0, buyers: new Set() };
      p.totalQty += remaining(r); p.requests++; p.buyers.add(r.buyerId);
      pools.set(poolKey(r), p);
    }
  }
  const view = (r: DemandRequest, bids: Bid[]): RequestView => {
    const { version: _v, ...rest } = r;
    const p = pools.get(poolKey(r));
    return { ...rest, bids, bidCount: r.bids.filter((b) => b.status === 'open').length,
      ...(expired(r) ? { expired: true } : {}),
      ...(p && r.status === 'open' && !expired(r) && p.requests > 1 ? { pool: { totalQty: p.totalQty, requests: p.requests, buyers: p.buyers.size } } : {}) };
  };

  let out: RequestView[];
  if (actor.role === 'operator') out = all.map((r) => view(r, r.bids));
  else if (actor.role === 'buyer') out = all.filter((r) => r.buyerId === actor.id).map((r) => view(r, r.bids));
  else {
    out = all
      .filter((r) => r.id === forceId || r.bids.some((b) => b.producerId === actor.id) || (r.status === 'open' && !expired(r) && inRange(ctx, r.buyerId, actor.id, catOf(r))))
      .map((r) => view(r, r.bids.filter((b) => b.producerId === actor.id)));
  }
  if (forceId) out = out.filter((r) => r.id === forceId); // a reply after a change wants just that one
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---- creating and closing --------------------------------------------------------------------

export async function createRequest(s: Session, actor: Organisation | undefined, body: Record<string, any>): Promise<Result<{ request?: RequestView }>> {
  if (actor?.role !== 'buyer') return fail(403, 'Only buyers can make requests');
  const ctx = await load(s);
  if (!ctx.config.demandOn) return fail(409, OFF);
  const other = body.productId === OTHER_PRODUCT;
  const product = ctx.products.get(body.productId);
  if (!other && !product) return fail(400, 'Unknown product');
  const category = categoryOf(ctx, other ? OTHER_PRODUCT : body.productId);
  if (!category) return fail(409, NO_CATEGORIES);
  if (!isQty(body.qty)) return fail(400, 'qty must be a whole number of at least 1');
  if (!isIsoDate(body.deliveryDate)) return fail(400, 'deliveryDate required (YYYY-MM-DD)');
  // Any day from tomorrow is fine, even one the product is not normally delivered on, or at short notice: producers can
  // answer with a different date, or a special delivery (the screens say so)
  if (body.deliveryDate <= todayIso()) return fail(400, 'Choose tomorrow or a later day');
  if (body.deliveryDate > addDays(todayIso(), MAX_DAYS_AHEAD)) return fail(400, 'That date is too far ahead');
  if (body.targetPrice !== undefined && body.targetPrice !== null && !isMoney(body.targetPrice)) return fail(400, 'targetPrice must be a positive number');
  const targetPrice = body.targetPrice ?? undefined;
  if (ctx.config.speculative === 'first_accept' && targetPrice === undefined) return fail(400, 'First-to-accept requests need a price you will pay');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;
  if (other && !note) return fail(400, 'Say what you want in the note, so producers know what to offer');

  const seq = await s.nextSeq('META', 'request-seq');
  const request: DemandRequest = {
    id: `DR-${100 + seq}`, buyerId: actor.id, productId: other ? OTHER_PRODUCT : product!.id, qty: body.qty, deliveryDate: body.deliveryDate,
    targetPrice, note, status: 'open', filledQty: 0, bids: [], createdAt: new Date().toISOString(), version: 1,
  };
  await s.create('REQUEST', request.id, request);
  await quietly('telling producers of a new request', async () => {
    const interested: string[] = [];
    for (const id of Object.keys(ctx.distances[actor.id] ?? {})) {
      const org = await s.get<Organisation>('ORG', id);
      if (org?.role === 'producer' && inRange(ctx, actor.id, id, category)) interested.push(id);
    }
    await say(s, 'request_new', request, { price: targetPrice }, interested);
  });
  return { ok: true, request: await viewOf(s, actor, request.id, ctx) };
}

/**
 * A buyer can close their own request even while demand requests are switched off: only new business stops.
 * (The screens hide demand entirely while it is off, so this is for API callers and for tidying up through the operator.)
 */
export async function closeRequest(s: Session, actor: Organisation | undefined, id: string): Promise<Result<{ request?: RequestView }>> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', id);
    if (!r) return fail(404, 'No such request');
    if (!(actor?.role === 'operator' || (actor?.role === 'buyer' && actor.id === r.buyerId))) return fail(403, 'Only the buyer can close this request');
    if (r.status !== 'open') return fail(409, `This request is already ${r.status}`);
    const bidders = r.bids.filter((b) => b.status === 'open').map((b) => b.producerId);
    const next: DemandRequest = { ...r, status: 'closed', version: r.version + 1, bids: r.bids.map((b) => (b.status === 'open' ? { ...b, status: 'rejected' } : b)) };
    const tx = await s.transact([s.tPut('REQUEST', id, next, '#v = :v', { '#v': 'version' }, { ':v': r.version })]);
    if (tx.ok) {
      await say(s, 'request_closed', next, {}, bidders);
      return { ok: true, request: await viewOf(s, actor, id) };
    }
  }
  return fail(409, 'The request changed at the same time; please look again');
}

// ---- bidding -----------------------------------------------------------------------------------

type BidBody = { price?: unknown; qty?: unknown; note?: unknown; deliveryDate?: unknown; productId?: unknown };

/**
 * A producer bids on a request. Under pooled demand a single bid (a total capacity and a price) is spread
 * across every open request for that product and week, oldest first, so the producer answers the whole pool at once.
 */
export async function placeBid(s: Session, actor: Organisation | undefined, id: string, body: BidBody): Promise<Result<{ bids: Bid[] }>> {
  if (actor?.role !== 'producer') return fail(403, 'Only producers can bid');
  const ctx = await load(s);
  if (!ctx.config.demandOn) return fail(409, OFF);
  if (ctx.config.speculative === 'first_accept') return fail(409, 'Under first-to-accept there is no bidding: accept the buyer\'s price instead');
  if (!isMoney(body.price)) return fail(400, 'price must be a positive number');
  if (!isQty(body.qty)) return fail(400, 'qty must be a whole number of at least 1');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;
  // The producer may offer a different delivery day from the one asked for: earlier (if it keeps), later, or a special delivery
  let deliveryDate: string | undefined;
  if (body.deliveryDate !== undefined && body.deliveryDate !== null && body.deliveryDate !== '') {
    if (!isIsoDate(body.deliveryDate)) return fail(400, 'deliveryDate must be YYYY-MM-DD');
    if (body.deliveryDate <= todayIso()) return fail(400, 'Delivery must be tomorrow or later');
    if (body.deliveryDate > addDays(todayIso(), MAX_DAYS_AHEAD)) return fail(400, 'That delivery date is too far ahead');
    deliveryDate = body.deliveryDate;
  }

  const first = await s.get<DemandRequest>('REQUEST', id);
  if (!first) return fail(404, 'No such request');
  const category = categoryOf(ctx, first.productId);
  if (!category) return fail(409, NO_CATEGORIES);
  // What is offered: the product asked for unless the producer names another. A request for something else needs it named
  const offered = offeredProduct(ctx, first, body.productId);
  if (!offered.ok) return offered;
  if (first.status !== 'open') return fail(409, `This request is already ${first.status}`);
  if (!inRange(ctx, first.buyerId, actor.id, category)) return fail(403, 'This buyer is outside your local range');
  // Which requests does this bid apply to?
  let targets = [first];
  let leftOut: DemandRequest[] = []; // requests in this pool that have expired: any bid of theirs there is withdrawn below
  if (ctx.config.speculative === 'pooled' && first.productId !== OTHER_PRODUCT && offered.productId === first.productId) {
    targets = (await s.list<DemandRequest>('REQUEST'))
      .filter((r) => r.status === 'open' && poolKey(r) === poolKey(first) && inRange(ctx, r.buyerId, actor.id, category))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } else if (body.qty > remaining(first)) {
    return fail(400, `You can offer at most ${remaining(first)} (what is still wanted)`);
  }

  // A request whose day has gone is no longer open to bids, whatever date the bid names. Any earlier bid of theirs on it is withdrawn below
  if (targets.some(expired)) {
    leftOut = targets.filter(expired);
    targets = targets.filter((t) => !expired(t));
    if (!targets.length) {
      for (const l of leftOut) if (hasOpenBid(l, actor.id)) await dropOpenBid(s, actor, l.id);
      return fail(409, PASSED);
    }
  }

  const placed: Bid[] = [];
  let capacity = body.qty as number;
  let busy = false;
  for (const t of targets) {
    const give = Math.min(capacity, remaining(t));
    if (give <= 0) {
      // Capacity is used up: an earlier, larger bid on this request must not stay open
      if (hasOpenBid(t, actor.id) && !(await dropOpenBid(s, actor, t.id))) busy = true;
      continue;
    }
    const res = await upsertBid(s, t.id, actor.id, { price: body.price as number, qty: give, note, deliveryDate, productId: offered.productId });
    if (res === 'closed') continue; // nothing is promised there, so the capacity goes to the others
    if (res === 'busy') { capacity -= give; busy = true; continue; } // an earlier bid may still stand, so keep that share set aside
    capacity -= res.bid.qty; // the bid as stored: it may have been trimmed to what is still wanted
    placed.push(res.bid);
    if (!res.changed) continue; // sent again unchanged (a retry): same bid, same id, and nobody is told twice
    const live = (await s.get<DemandRequest>('REQUEST', t.id))!;
    await say(s, 'bid_placed', live, { producer: actor.name, price: res.bid.price, qty: res.bid.qty, productId: offered.productId }, [t.buyerId]);
  }
  for (const l of leftOut) if (hasOpenBid(l, actor.id) && !(await dropOpenBid(s, actor, l.id))) busy = true;
  // Sending the same bid again is safe (it replaces this producer's open bids), so a partial result is reported as a failure to retry
  if (busy) {
    return fail(409, `Several people are bidding on this at once. Your bid went in on ${placed.length} of ${targets.length} request${targets.length === 1 ? '' : 's'}: send it again to finish (what is already in stays as it is).`);
  }
  if (placed.length === 0) return fail(409, 'Nothing to bid on: the request has been filled or closed');
  return { ok: true, bids: placed };
}

const hasOpenBid = (r: DemandRequest, producerId: string) => r.bids.some((b) => b.producerId === producerId && b.status === 'open');

/** Withdraw this producer's open bid on a request, if they have one, and tell the buyer. False if it could not be done. */
async function dropOpenBid(s: Session, actor: Organisation, requestId: string): Promise<boolean> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', requestId);
    if (!r || r.status !== 'open' || !r.bids.some((b) => b.producerId === actor.id && b.status === 'open')) return true;
    const next = { ...r, version: r.version + 1, bids: r.bids.map((b) => (b.producerId === actor.id && b.status === 'open' ? { ...b, status: 'withdrawn' as const } : b)) };
    if ((await s.transact([s.tPut('REQUEST', requestId, next, '#v = :v', { '#v': 'version' }, { ':v': r.version })])).ok) {
      await say(s, 'bid_withdrawn', next, { producer: actor.name }, [r.buyerId]);
      return true;
    }
  }
  return false;
}

/** The product a producer offers against a request: the one named, else the one asked for. Must be a real catalogue product. */
function offeredProduct(ctx: Ctx, r: DemandRequest, named: unknown): Result<{ productId: string }> {
  const id = named === undefined || named === null || named === '' ? r.productId : named;
  if (id === OTHER_PRODUCT) return fail(400, 'Say what you are offering');
  if (typeof id !== 'string' || !ctx.products.has(id)) return fail(400, 'Unknown product offered');
  return { ok: true, productId: id };
}

/** Add this producer's bid to a request, replacing any earlier open bid from them. */
async function upsertBid(s: Session, requestId: string, producerId: string, v: { price: number; qty: number; note?: string; deliveryDate?: string; productId: string }): Promise<{ bid: Bid; changed: boolean } | 'closed' | 'busy'> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', requestId);
    if (!r || r.status !== 'open') return 'closed';
    // The same bid again (a retry after a partial failure) is left exactly as it is
    const qty = Math.min(v.qty, remaining(r));
    const same = r.bids.find((b) => b.producerId === producerId && b.status === 'open' && b.price === v.price && b.qty === qty && b.note === v.note
      && b.deliveryDate === v.deliveryDate && (b.productId ?? r.productId) === v.productId);
    if (same) return { bid: same, changed: false };
    const bid: Bid = { id: `b-${Date.now().toString(36)}${rand()}`, producerId, productId: v.productId, price: v.price, qty, note: v.note, ...(v.deliveryDate ? { deliveryDate: v.deliveryDate } : {}), createdAt: new Date().toISOString(), status: 'open' };
    const bids = [...r.bids.filter((b) => !(b.producerId === producerId && b.status === 'open')), bid];
    const tx = await s.transact([s.tPut('REQUEST', requestId, { ...r, bids, version: r.version + 1 }, '#v = :v', { '#v': 'version' }, { ':v': r.version })]);
    if (tx.ok) return { bid, changed: true };
  }
  return 'busy';
}

/** A producer can withdraw their own bid even while demand requests are switched off (see closeRequest). */
export async function withdrawBid(s: Session, actor: Organisation | undefined, id: string, bidId: string): Promise<Result> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', id);
    if (!r) return fail(404, 'No such request');
    const bid = r.bids.find((b) => b.id === bidId);
    if (!bid) return fail(404, 'No such bid');
    if (!(actor?.role === 'operator' || (actor?.role === 'producer' && actor.id === bid.producerId))) return fail(403, 'Only the bidder can withdraw a bid');
    if (bid.status !== 'open') return fail(409, `This bid is already ${bid.status}`);
    const next = { ...r, version: r.version + 1, bids: r.bids.map((b) => (b.id === bidId ? { ...b, status: 'withdrawn' as const } : b)) };
    if ((await s.transact([s.tPut('REQUEST', id, next, '#v = :v', { '#v': 'version' }, { ':v': r.version })])).ok) {
      await quietly('telling the buyer a bid was withdrawn', async () => say(s, 'bid_withdrawn', next, { producer: await orgName(s, bid.producerId) }, [r.buyerId]));
      return { ok: true };
    }
  }
  return fail(409, 'The request changed at the same time; please try again');
}

// ---- accepting ---------------------------------------------------------------------------------

/**
 * A buyer accepts a bid, or (first-to-accept) a producer accepts the buyer's price. Either way the result is one
 * confirmed order with stock reserved, the producer gets a listing for the product if they had none, and the
 * week gains supply equal to what was promised, so the commitment never eats into their other stock.
 */
async function fulfil(
  s: Session, ctx: Ctx, requestId: string, producerId: string,
  choose: (r: DemandRequest) => Result<{ bid: Bid }>, by: string,
): Promise<Result<{ order: Order }>> {
  let seq: number | undefined; // taken once, when an order is first about to be made, so refusals leave no gaps in order numbers
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', requestId);
    if (!r) return fail(404, 'No such request');
    if (r.status !== 'open') return fail(409, `This request is already ${r.status}`);
    if (expired(r)) return fail(409, PASSED); // whatever day the bid itself names
    const chosen = choose(r);
    if (!chosen.ok) return chosen;
    const { bid } = chosen;
    const qty = bid.qty;
    if (qty > remaining(r)) return fail(409, `Only ${remaining(r)} is still wanted`);

    // The order is for what was offered, which need not be what was asked for
    const productId = bid.productId ?? r.productId;
    if (!ctx.products.has(productId)) return fail(400, 'This offer does not say what is being offered');
    const listingId = `${producerId}:${productId}`;
    const listing: Listing = { id: listingId, producerId, productId, pricePerUnit: bid.price, minOrder: 1, certifications: [] };
    const hasListing = !!(await s.get<Listing>('LISTING', listingId));

    // Delivered on the day the bid offered (else the day asked for). If that is not one of the producer's usual days
    // for this buyer, it is a special delivery
    const deliveryDate = bid.deliveryDate ?? r.deliveryDate;
    if (deliveryDate <= todayIso()) return fail(409, BID_DAY_PASSED);
    const category = categoryOf(ctx, productId);
    if (!category) return fail(409, NO_CATEGORIES);
    const producerOrg = await s.get<Organisation>('ORG', producerId);
    const buyerOrg = await s.get<Organisation>('ORG', r.buyerId);
    const special = !isUsualDay(deliveryRule(ctx.config, category, undefined, producerOrg, buyerOrg?.area), deliveryDate);

    const monday = mondayOf(deliveryDate);
    const winSk = `${listingId}#${monday}`;
    const existing = await s.get<SupplyWindow>('WINDOW', winSk);
    const windowOp: TxItem = existing
      ? s.tUpdate('WINDOW', winSk, 'ADD #qt :q, #qr :q', { '#qt': 'qtyTotal', '#qr': 'qtyReserved' }, { ':q': qty }, 'attribute_exists(pk)')
      : s.tPut('WINDOW', winSk, { listingId, start: monday, end: addDays(monday, 6), qtyTotal: qty, qtyReserved: qty, confidence: 'in_stock' } satisfies SupplyWindow, 'attribute_not_exists(pk)');

    seq ??= await s.nextSeq('META', 'order-seq');
    const at = new Date().toISOString();
    const order: Order = {
      id: `BL-${1000 + seq}`, groupId: `g-${requestId}-${bid.id}`, buyerId: r.buyerId, producerId, deliveryDate,
      ...(special ? { special: true } : {}), status: 'confirmed', stock: 'reserved', deliveryMode: ctx.config.delivery as Order['deliveryMode'], lines: [{ listingId, productId, qty, unitPrice: bid.price, ...(r.note ? { note: r.note } : {}) }],
      total: Math.round(qty * bid.price * 100) / 100, source: { requestId, bidId: bid.id }, createdAt: at,
      history: [{ at, status: 'confirmed', by }],
    };
    const filledQty = r.filledQty + qty;
    const filled = filledQty >= r.qty;
    const accepted: Bid = { ...bid, status: 'accepted', orderId: order.id };
    const bids = [
      ...r.bids.filter((b) => b.id !== bid.id).map((b) => (filled && b.status === 'open' ? { ...b, status: 'rejected' as const } : b)),
      accepted,
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const next: DemandRequest = { ...r, filledQty, status: filled ? 'filled' : 'open', bids, version: r.version + 1 };

    const tx = await s.transact([
      s.tPut('REQUEST', requestId, next, '#v = :v', { '#v': 'version' }, { ':v': r.version }),
      s.tPut('ORDER', order.id, order, 'attribute_not_exists(pk)'),
      windowOp,
      // The producer gains a listing for what they offered, in the same step as the order; if someone else just made it, we go round again
      // If they already had it, check it is still there (a no-change update with a condition): they may have just removed it
      hasListing
        ? s.tUpdate('LISTING', listingId, 'SET #p = :pid', { '#p': 'producerId' }, { ':pid': producerId }, 'attribute_exists(pk) AND #p = :pid')
        : s.tPut('LISTING', listingId, listing, 'attribute_not_exists(pk)'),
    ]);
    if (tx.ok) {
      await quietly('telling people about an accepted bid', async () => {
        const producer = await orgName(s, producerId);
        await say(s, 'bid_accepted', next, { producer, orderId: order.id, qty, price: bid.price }, [producerId, r.buyerId]);
        if (filled) {
          const losers = r.bids.filter((b) => b.status === 'open' && b.id !== bid.id).map((b) => b.producerId);
          if (losers.length) await say(s, 'bid_rejected', next, {}, losers);
          if (ctx.config.speculative === 'first_accept') {
            // Nobody bid, so tell everyone who could have taken it that it has gone
            const category = categoryOf(ctx, r.productId);
            const others: string[] = [];
            for (const id of Object.keys(ctx.distances[r.buyerId] ?? {})) {
              const org = await s.get<Organisation>('ORG', id);
              if (org?.role === 'producer' && id !== producerId && inRange(ctx, r.buyerId, id, category)) others.push(id);
            }
            if (others.length) await say(s, 'request_filled', next, {}, others);
          }
        }
      });
      return { ok: true, order };
    }
  }
  return fail(409, 'Somebody else got there first, or the request changed. Please look again.');
}

export async function acceptBid(s: Session, actor: Organisation | undefined, id: string, bidId: unknown): Promise<Result<{ order: Order; request?: RequestView }>> {
  const r0 = await s.get<DemandRequest>('REQUEST', id);
  if (!r0) return fail(404, 'No such request');
  if (!(actor?.role === 'operator' || (actor?.role === 'buyer' && actor.id === r0.buyerId))) return fail(403, 'Only the buyer can accept a bid');
  const bid0 = r0.bids.find((b) => b.id === bidId);
  if (!bid0) return fail(404, 'No such bid');
  const ctx = await load(s);
  if (!ctx.config.demandOn) return fail(409, OFF);
  const res = await fulfil(s, ctx, id, bid0.producerId, (r) => {
    const b = r.bids.find((x) => x.id === bidId);
    return !b ? fail(404, 'No such bid') : b.status !== 'open' ? fail(409, `This bid is already ${b.status}`) : { ok: true, bid: b };
  }, actor!.id);
  return res.ok ? { ...res, request: await viewOf(s, actor, id, ctx) } : res;
}

/** First-to-accept: a producer takes the buyer's whole request at the buyer's price; the first to arrive wins. */
export async function takeRequest(s: Session, actor: Organisation | undefined, id: string, body: { productId?: unknown } = {}): Promise<Result<{ order: Order; request?: RequestView }>> {
  if (actor?.role !== 'producer') return fail(403, 'Only producers can accept a request');
  const ctx = await load(s);
  if (!ctx.config.demandOn) return fail(409, OFF);
  if (ctx.config.speculative !== 'first_accept') return fail(409, 'Requests are not first-to-accept under the current model; place a bid instead');
  const r0 = await s.get<DemandRequest>('REQUEST', id);
  if (!r0) return fail(404, 'No such request');
  const category = categoryOf(ctx, r0.productId);
  if (!category) return fail(409, NO_CATEGORIES);
  if (!inRange(ctx, r0.buyerId, actor.id, category)) return fail(403, 'This buyer is outside your local range');
  const offered = offeredProduct(ctx, r0, body.productId);
  if (!offered.ok) return offered;
  if (r0.targetPrice === undefined) return fail(409, 'This request has no price to accept; place a bid instead');
  const res = await fulfil(s, ctx, id, actor.id, (r) => {
    if (r.filledQty > 0) return fail(409, 'Somebody else already accepted this request');
    return { ok: true, bid: { id: `b-${Date.now().toString(36)}${rand()}`, producerId: actor.id, productId: offered.productId, price: r.targetPrice!, qty: r.qty, createdAt: new Date().toISOString(), status: 'open' } };
  }, actor.id);
  return res.ok ? { ...res, request: await viewOf(s, actor, id, ctx) } : res;
}
