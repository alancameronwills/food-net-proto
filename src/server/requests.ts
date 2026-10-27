import { addDays, isIsoDate, mondayOf, todayIso } from '../shared/dates';
import { localStatus } from '../shared/models';
import { MAX_DAYS_AHEAD, deliveryRule, isUsualDay } from '../shared/delivery';
import type { Bid, Category, DemandRequest, Listing, Order, Organisation, RequestView, SupplyWindow } from '../shared/types';
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

async function load(s: Session) {
  const [config, categories, products, distances] = await Promise.all([getConfig(s), listCategories(s), listProducts(s), getDistances(s)]);
  return {
    config, distances,
    categories: new Map(categories.map((c) => [c.id, c])),
    products: new Map(products.map((p) => [p.id, p])),
  };
}
type Ctx = Awaited<ReturnType<typeof load>>;

/** Can this producer take part in a buyer's request, under the local-range model? */
function inRange(ctx: Ctx, buyerId: string, producerId: string, category: Category): boolean {
  const km = ctx.distances[buyerId]?.[producerId];
  return km !== undefined && localStatus(ctx.config, category.maxDriveKm, km) !== 'hidden';
}

const remaining = (r: DemandRequest) => r.qty - r.filledQty;
const OFF = 'Demand requests are switched off. The network operator can switch them on in the Model Lab.';

const poolKey = (r: Pick<DemandRequest, 'productId' | 'deliveryDate'>) => `${r.productId}#${mondayOf(r.deliveryDate)}`;

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
  if (!(await getConfig(s)).demandOn) return []; // kept, but out of sight until switched back on
  const all = await s.list<DemandRequest>('REQUEST');
  const ctx = await load(s);
  const catOf = (r: DemandRequest) => ctx.categories.get(ctx.products.get(r.productId)!.category)!;

  const pools = new Map<string, { totalQty: number; requests: number; buyers: Set<string> }>();
  if (ctx.config.speculative === 'pooled') {
    for (const r of all.filter((x) => x.status === 'open')) {
      const p = pools.get(poolKey(r)) ?? { totalQty: 0, requests: 0, buyers: new Set() };
      p.totalQty += remaining(r); p.requests++; p.buyers.add(r.buyerId);
      pools.set(poolKey(r), p);
    }
  }
  const view = (r: DemandRequest, bids: Bid[]): RequestView => {
    const { version: _v, ...rest } = r;
    const p = pools.get(poolKey(r));
    return { ...rest, bids, bidCount: r.bids.filter((b) => b.status === 'open').length,
      ...(p && r.status === 'open' && p.requests > 1 ? { pool: { totalQty: p.totalQty, requests: p.requests, buyers: p.buyers.size } } : {}) };
  };

  let out: RequestView[];
  if (actor.role === 'operator') out = all.map((r) => view(r, r.bids));
  else if (actor.role === 'buyer') out = all.filter((r) => r.buyerId === actor.id).map((r) => view(r, r.bids));
  else {
    out = all
      .filter((r) => r.bids.some((b) => b.producerId === actor.id) || (r.status === 'open' && inRange(ctx, r.buyerId, actor.id, catOf(r))))
      .map((r) => view(r, r.bids.filter((b) => b.producerId === actor.id)));
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---- creating and closing --------------------------------------------------------------------

export async function createRequest(s: Session, actor: Organisation | undefined, body: Record<string, any>): Promise<Result<{ request: RequestView }>> {
  if (actor?.role !== 'buyer') return fail(403, 'Only buyers can make requests');
  const ctx = await load(s);
  if (!ctx.config.demandOn) return fail(409, OFF);
  const product = ctx.products.get(body.productId);
  const category = product && ctx.categories.get(product.category);
  if (!product || !category) return fail(400, 'Unknown product');
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

  const seq = await s.nextSeq('META', 'request-seq');
  const request: DemandRequest = {
    id: `DR-${100 + seq}`, buyerId: actor.id, productId: product.id, qty: body.qty, deliveryDate: body.deliveryDate,
    targetPrice, note, status: 'open', filledQty: 0, bids: [], createdAt: new Date().toISOString(), version: 1,
  };
  await s.create('REQUEST', request.id, request);
  const interested: string[] = [];
  for (const id of Object.keys(ctx.distances[actor.id] ?? {})) {
    const org = await s.get<Organisation>('ORG', id);
    if (org?.role === 'producer' && inRange(ctx, actor.id, id, category)) interested.push(id);
  }
  await say(s, 'request_new', request, { price: targetPrice }, interested);
  return { ok: true, request: (await listRequests(s, actor)).find((r) => r.id === request.id)! };
}

export async function closeRequest(s: Session, actor: Organisation | undefined, id: string): Promise<Result<{ request: RequestView }>> {
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
      return { ok: true, request: (await listRequests(s, actor)).find((x) => x.id === id)! };
    }
  }
  return fail(409, 'The request changed at the same time; please look again');
}

// ---- bidding -----------------------------------------------------------------------------------

type BidBody = { price?: unknown; qty?: unknown; note?: unknown; deliveryDate?: unknown };

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
  const product = ctx.products.get(first.productId)!;
  const category = ctx.categories.get(product.category)!;
  if (first.status !== 'open') return fail(409, `This request is already ${first.status}`);
  if (!inRange(ctx, first.buyerId, actor.id, category)) return fail(403, 'This buyer is outside your local range');
  // Which requests does this bid apply to?
  let targets = [first];
  if (ctx.config.speculative === 'pooled') {
    targets = (await s.list<DemandRequest>('REQUEST'))
      .filter((r) => r.status === 'open' && poolKey(r) === poolKey(first) && inRange(ctx, r.buyerId, actor.id, category))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } else if (body.qty > remaining(first)) {
    return fail(400, `You can offer at most ${remaining(first)} (what is still wanted)`);
  }

  const placed: Bid[] = [];
  let capacity = body.qty as number;
  for (const t of targets) {
    const give = Math.min(capacity, remaining(t));
    if (give <= 0) continue;
    const bid = await upsertBid(s, t.id, actor.id, { price: body.price as number, qty: give, note, deliveryDate });
    if (!bid) continue;
    capacity -= give;
    placed.push(bid);
    const live = (await s.get<DemandRequest>('REQUEST', t.id))!;
    await say(s, 'bid_placed', live, { producer: actor.name, price: bid.price, qty: bid.qty }, [t.buyerId]);
  }
  if (placed.length === 0) return fail(409, 'Nothing to bid on: the request has been filled or closed');
  return { ok: true, bids: placed };
}

/** Add this producer's bid to a request, replacing any earlier open bid from them. */
async function upsertBid(s: Session, requestId: string, producerId: string, v: { price: number; qty: number; note?: string; deliveryDate?: string }): Promise<Bid | undefined> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', requestId);
    if (!r || r.status !== 'open') return undefined;
    const bid: Bid = { id: `b-${Date.now().toString(36)}${rand()}`, producerId, price: v.price, qty: Math.min(v.qty, remaining(r)), note: v.note, ...(v.deliveryDate ? { deliveryDate: v.deliveryDate } : {}), createdAt: new Date().toISOString(), status: 'open' };
    const bids = [...r.bids.filter((b) => !(b.producerId === producerId && b.status === 'open')), bid];
    const tx = await s.transact([s.tPut('REQUEST', requestId, { ...r, bids, version: r.version + 1 }, '#v = :v', { '#v': 'version' }, { ':v': r.version })]);
    if (tx.ok) return bid;
  }
  return undefined;
}

export async function withdrawBid(s: Session, actor: Organisation | undefined, id: string, bidId: string): Promise<Result> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', id);
    if (!r) return fail(404, 'No such request');
    const bid = r.bids.find((b) => b.id === bidId);
    if (!bid) return fail(404, 'No such bid');
    if (!(actor?.role === 'operator' || (actor?.role === 'producer' && actor.id === bid.producerId))) return fail(403, 'Only the bidder can withdraw a bid');
    if (bid.status !== 'open') return fail(409, `This bid is already ${bid.status}`);
    const next = { ...r, version: r.version + 1, bids: r.bids.map((b) => (b.id === bidId ? { ...b, status: 'withdrawn' as const } : b)) };
    if ((await s.transact([s.tPut('REQUEST', id, next, '#v = :v', { '#v': 'version' }, { ':v': r.version })])).ok) return { ok: true };
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
  const seq = await s.nextSeq('META', 'order-seq');
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await s.get<DemandRequest>('REQUEST', requestId);
    if (!r) return fail(404, 'No such request');
    if (r.status !== 'open') return fail(409, `This request is already ${r.status}`);
    const chosen = choose(r);
    if (!chosen.ok) return chosen;
    const { bid } = chosen;
    const qty = bid.qty;
    if (qty > remaining(r)) return fail(409, `Only ${remaining(r)} is still wanted`);

    const listingId = `${producerId}:${r.productId}`;
    const listing: Listing = { id: listingId, producerId, productId: r.productId, pricePerUnit: bid.price, minOrder: 1, certifications: [] };
    await s.create('LISTING', listingId, listing); // harmless if they already sell it

    // Delivered on the day the bid offered (else the day asked for). If that is not one of the producer's usual days
    // for this buyer, it is a special delivery
    const deliveryDate = bid.deliveryDate ?? r.deliveryDate;
    const category = ctx.categories.get(ctx.products.get(r.productId)!.category)!;
    const producerOrg = await s.get<Organisation>('ORG', producerId);
    const buyerOrg = await s.get<Organisation>('ORG', r.buyerId);
    const special = !isUsualDay(deliveryRule(ctx.config, category, undefined, producerOrg, buyerOrg?.area), deliveryDate);

    const monday = mondayOf(deliveryDate);
    const winSk = `${listingId}#${monday}`;
    const existing = await s.get<SupplyWindow>('WINDOW', winSk);
    const windowOp: TxItem = existing
      ? s.tUpdate('WINDOW', winSk, 'ADD #qt :q, #qr :q', { '#qt': 'qtyTotal', '#qr': 'qtyReserved' }, { ':q': qty }, 'attribute_exists(pk)')
      : s.tPut('WINDOW', winSk, { listingId, start: monday, end: addDays(monday, 6), qtyTotal: qty, qtyReserved: qty, confidence: 'in_stock' } satisfies SupplyWindow, 'attribute_not_exists(pk)');

    const at = new Date().toISOString();
    const order: Order = {
      id: `BL-${1000 + seq}`, groupId: `g-${requestId}-${bid.id}`, buyerId: r.buyerId, producerId, deliveryDate,
      ...(special ? { special: true } : {}), status: 'confirmed', stock: 'reserved', deliveryMode: ctx.config.delivery as Order['deliveryMode'], lines: [{ listingId, productId: r.productId, qty, unitPrice: bid.price, ...(r.note ? { note: r.note } : {}) }],
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
    ]);
    if (tx.ok) {
      const producer = await orgName(s, producerId);
      await say(s, 'bid_accepted', next, { producer, orderId: order.id, qty, price: bid.price }, [producerId, r.buyerId]);
      if (filled) {
        const losers = r.bids.filter((b) => b.status === 'open' && b.id !== bid.id).map((b) => b.producerId);
        if (losers.length) await say(s, 'bid_rejected', next, {}, losers);
        if (ctx.config.speculative === 'first_accept') {
          // Nobody bid, so tell everyone who could have taken it that it has gone
          const category = ctx.categories.get(ctx.products.get(r.productId)!.category)!;
          const others: string[] = [];
          for (const id of Object.keys(ctx.distances[r.buyerId] ?? {})) {
            const org = await s.get<Organisation>('ORG', id);
            if (org?.role === 'producer' && id !== producerId && inRange(ctx, r.buyerId, id, category)) others.push(id);
          }
          if (others.length) await say(s, 'request_filled', next, {}, others);
        }
      }
      return { ok: true, order };
    }
  }
  return fail(409, 'Somebody else got there first, or the request changed. Please look again.');
}

export async function acceptBid(s: Session, actor: Organisation | undefined, id: string, bidId: unknown): Promise<Result<{ order: Order; request: RequestView }>> {
  const r0 = await s.get<DemandRequest>('REQUEST', id);
  if (!r0) return fail(404, 'No such request');
  if (!(actor?.role === 'operator' || (actor?.role === 'buyer' && actor.id === r0.buyerId))) return fail(403, 'Only the buyer can accept a bid');
  const bid0 = r0.bids.find((b) => b.id === bidId);
  if (!bid0) return fail(404, 'No such bid');
  const ctx = await load(s);
  const res = await fulfil(s, ctx, id, bid0.producerId, (r) => {
    const b = r.bids.find((x) => x.id === bidId);
    return !b ? fail(404, 'No such bid') : b.status !== 'open' ? fail(409, `This bid is already ${b.status}`) : { ok: true, bid: b };
  }, actor!.id);
  return res.ok ? { ...res, request: (await listRequests(s, actor)).find((x) => x.id === id)! } : res;
}

/** First-to-accept: a producer takes the buyer's whole request at the buyer's price; the first to arrive wins. */
export async function takeRequest(s: Session, actor: Organisation | undefined, id: string): Promise<Result<{ order: Order; request: RequestView }>> {
  if (actor?.role !== 'producer') return fail(403, 'Only producers can accept a request');
  const ctx = await load(s);
  if (!ctx.config.demandOn) return fail(409, OFF);
  if (ctx.config.speculative !== 'first_accept') return fail(409, 'Requests are not first-to-accept under the current model; place a bid instead');
  const r0 = await s.get<DemandRequest>('REQUEST', id);
  if (!r0) return fail(404, 'No such request');
  const category = ctx.categories.get(ctx.products.get(r0.productId)!.category)!;
  if (!inRange(ctx, r0.buyerId, actor.id, category)) return fail(403, 'This buyer is outside your local range');
  if (r0.targetPrice === undefined) return fail(409, 'This request has no price to accept; place a bid instead');
  const res = await fulfil(s, ctx, id, actor.id, (r) => {
    if (r.filledQty > 0) return fail(409, 'Somebody else already accepted this request');
    return { ok: true, bid: { id: `b-${Date.now().toString(36)}${rand()}`, producerId: actor.id, price: r.targetPrice!, qty: r.qty, createdAt: new Date().toISOString(), status: 'open' } };
  }, actor.id);
  return res.ok ? { ...res, request: (await listRequests(s, actor)).find((x) => x.id === id)! } : res;
}
