import { isIsoDate, todayIso } from '../shared/dates';
import { capabilities } from '../shared/models';
import { availabilityFor, lineTotal, reservableLimit, unitPriceFor, windowKey, type Unavailable } from '../shared/orders';
import type { Order, OrderLine, OrderStatus, Organisation, StockState, SupplyWindow } from '../shared/types';
import type { Session, TxItem } from './db';
import type { Result } from './producer';
import { getConfig, getDistances, listCategories, listListings, listProducts } from './store';

const fail = (status: 400 | 403 | 404 | 409, error: string): Result<never> => ({ ok: false, status, error });
const MAX_LINES = 25; // a transaction holds at most 100 items; one order never gets near that
const RETRIES = 3;

const REASON: Record<Unavailable, string> = {
  not_delivery_day: 'is not delivered on that day',
  too_soon: 'needs more notice for that date',
  too_far: 'cannot be ordered that far ahead',
  no_supply: 'has no supply planned that week',
  provisional: 'is only provisional that week, so cannot be ordered yet',
  forecast_blocked: 'is forecast only, and forecast stock cannot be ordered under the current model',
  sold_out: 'is sold out that week',
  out_of_range: 'is outside the local range',
};

const winSk = (listingId: string, deliveryDate: string) => windowKey(listingId, deliveryDate);

/** Context shared by the operations below, read fresh on every attempt. */
async function load(s: Session) {
  const [config, categories, products, listings, distances] = await Promise.all([
    getConfig(s), listCategories(s), listProducts(s), listListings(s), getDistances(s),
  ]);
  return {
    config,
    categories: new Map(categories.map((c) => [c.id, c])),
    products: new Map(products.map((p) => [p.id, p])),
    listings: new Map(listings.map((l) => [l.id, l])),
    distances,
  };
}
type Ctx = Awaited<ReturnType<typeof load>>;

const nowIso = () => new Date().toISOString();

// ---- reading -------------------------------------------------------------------------------

export async function listOrders(s: Session, actor: Organisation | undefined): Promise<Order[]> {
  if (!actor) return [];
  const all = await s.list<Order>('ORDER');
  const mine = actor.role === 'operator' ? all
    : all.filter((o) => (actor.role === 'buyer' ? o.buyerId === actor.id : o.producerId === actor.id));
  return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---- stock reservation -----------------------------------------------------------------------

/** Window items that move `qtyReserved` by +qty (reserve) or -qty (release), guarded so stock cannot oversell or go negative. */
function stockOps(s: Session, ctx: Ctx, order: Pick<Order, 'lines' | 'deliveryDate'>, windows: Map<string, SupplyWindow>, dir: 'reserve' | 'release'): TxItem[] {
  return order.lines.map((l) => {
    const w = windows.get(winSk(l.listingId, order.deliveryDate))!;
    const names = { '#qr': 'qtyReserved', '#qt': 'qtyTotal', '#cf': 'confidence' };
    if (dir === 'reserve') {
      return s.tUpdate('WINDOW', winSk(l.listingId, order.deliveryDate), 'ADD #qr :n', names,
        { ':n': l.qty, ':max': reservableLimit(ctx.config, w) - l.qty, ':total': w.qtyTotal, ':conf': w.confidence },
        'attribute_exists(pk) AND #qr <= :max AND #qt = :total AND #cf = :conf');
    }
    return s.tUpdate('WINDOW', winSk(l.listingId, order.deliveryDate), 'ADD #qr :n', { '#qr': 'qtyReserved' },
      { ':n': -l.qty, ':min': l.qty }, 'attribute_exists(pk) AND #qr >= :min');
  });
}

async function readWindows(s: Session, order: Pick<Order, 'lines' | 'deliveryDate'>): Promise<Map<string, SupplyWindow>> {
  const out = new Map<string, SupplyWindow>();
  await Promise.all(order.lines.map(async (l) => {
    const w = await s.get<SupplyWindow>('WINDOW', winSk(l.listingId, order.deliveryDate));
    if (w) out.set(winSk(l.listingId, order.deliveryDate), w);
  }));
  return out;
}

/** Name the first line that no longer fits, for a useful error message. */
function shortfall(ctx: Ctx, order: Pick<Order, 'lines' | 'deliveryDate'>, windows: Map<string, SupplyWindow>): string | null {
  for (const l of order.lines) {
    const w = windows.get(winSk(l.listingId, order.deliveryDate));
    const name = ctx.products.get(l.productId)?.name.en ?? l.productId;
    if (!w) return `${name}: no supply planned that week`;
    const free = reservableLimit(ctx.config, w) - w.qtyReserved;
    if (l.qty > free) return `${name}: only ${Math.max(0, free)} available`;
  }
  return null;
}

// ---- placing -------------------------------------------------------------------------------

type PlaceBody = { deliveryDate?: unknown; lines?: unknown; note?: unknown };
export type Placed = { orders: Order[]; failed: { producerId: string; error: string }[] };

/**
 * Place a checkout: validate every line against live stock and the delivery rules, split it into
 * one order per producer, and (depending on the stock model) hold or reserve stock atomically.
 */
export async function placeOrders(s: Session, actor: Organisation | undefined, body: PlaceBody): Promise<Result<Placed>> {
  if (actor?.role !== 'buyer') return fail(403, 'Only buyers can place orders');
  if (!isIsoDate(body.deliveryDate)) return fail(400, 'deliveryDate required (YYYY-MM-DD)');
  const deliveryDate = body.deliveryDate;
  if (!Array.isArray(body.lines) || body.lines.length === 0) return fail(400, 'Your basket is empty');
  if (body.lines.length > MAX_LINES) return fail(400, `At most ${MAX_LINES} products per order`);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;

  const ctx = await load(s);
  const today = todayIso();
  const merged = new Map<string, number>();
  for (const raw of body.lines as { listingId?: unknown; qty?: unknown }[]) {
    if (typeof raw?.listingId !== 'string' || !Number.isInteger(raw.qty) || (raw.qty as number) <= 0) return fail(400, 'Each line needs a listingId and a whole quantity');
    merged.set(raw.listingId, (merged.get(raw.listingId) ?? 0) + (raw.qty as number));
  }

  const byProducer = new Map<string, OrderLine[]>();
  const windows = new Map<string, SupplyWindow>();
  for (const [listingId, qty] of merged) {
    const listing = ctx.listings.get(listingId);
    const product = listing && ctx.products.get(listing.productId);
    const category = product && ctx.categories.get(product.category);
    if (!listing || !product || !category) return fail(404, 'A product in your basket is no longer sold');
    if (qty < listing.minOrder) return fail(400, `${product.name.en}: minimum order is ${listing.minOrder}`);
    const w = await s.get<SupplyWindow>('WINDOW', winSk(listingId, deliveryDate));
    if (w) windows.set(winSk(listingId, deliveryDate), w);
    const av = availabilityFor({
      config: ctx.config, category, listing, window: w, date: deliveryDate, today,
      driveKm: ctx.distances[actor.id]?.[listing.producerId] ?? Infinity,
    });
    if (av.problem) return fail(409, `${product.name.en} ${REASON[av.problem]}`);
    if (qty > av.orderable) return fail(409, `${product.name.en}: only ${av.orderable} available`);
    const unitPrice = unitPriceFor(ctx.config, listing, qty);
    const lines = byProducer.get(listing.producerId) ?? [];
    lines.push({ listingId, productId: product.id, qty, unitPrice });
    byProducer.set(listing.producerId, lines);
  }

  const caps = capabilities(ctx.config);
  const groupId = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const result: Placed = { orders: [], failed: [] };
  for (const [producerId, lines] of byProducer) {
    const seq = await s.nextSeq('META', 'order-seq');
    const autoConfirm = !caps.producerConfirmsOrders; // "on placement": accepted automatically
    const stock: StockState = autoConfirm ? 'reserved' : caps.softHoldOnPlace ? 'held' : 'none';
    const status: OrderStatus = autoConfirm ? 'confirmed' : 'placed';
    const at = nowIso();
    const order: Order = {
      id: `BL-${1000 + seq}`, groupId, buyerId: actor.id, producerId, deliveryDate, status, stock, lines,
      total: Math.round(lines.reduce((n, l) => n + lineTotal(l.unitPrice, l.qty), 0) * 100) / 100,
      note, createdAt: at, history: [{ at, status, by: actor.id }],
    };
    const err = await writeNewOrder(s, ctx, order, windows);
    if (err) result.failed.push({ producerId, error: err }); else result.orders.push(order);
  }
  if (result.orders.length === 0) return fail(409, result.failed[0]?.error ?? 'Could not place the order');
  return { ok: true, ...result };
}

async function writeNewOrder(s: Session, ctx: Ctx, order: Order, known: Map<string, SupplyWindow>): Promise<string | null> {
  if (order.stock === 'none') {
    return (await s.create('ORDER', order.id, order)) ? null : 'Could not save the order';
  }
  let windows = known;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    windows = attempt === 0 ? known : await readWindows(s, order);
    const short = shortfall(ctx, order, windows);
    if (short) return short;
    const tx = await s.transact([
      s.tPut('ORDER', order.id, order, 'attribute_not_exists(pk)'),
      ...stockOps(s, ctx, order, windows, 'reserve'),
    ]);
    if (tx.ok) return null;
  }
  return 'Stock is changing quickly; please try again';
}

// ---- status changes ------------------------------------------------------------------------------

const names = { '#st': 'status', '#sk': 'stock', '#h': 'history', '#ua': 'updatedAt' };
function orderUpdate(s: Session, order: Order, to: OrderStatus, stock: StockState, by: string, note?: string): TxItem {
  const entry = { at: nowIso(), status: to, by, ...(note ? { note } : {}) };
  return s.tUpdate('ORDER', order.id, 'SET #st = :to, #sk = :stock, #ua = :at, #h = list_append(#h, :entry)', names,
    { ':to': to, ':stock': stock, ':at': entry.at, ':entry': [entry], ':from': order.status, ':oldstock': order.stock },
    '#st = :from AND #sk = :oldstock');
}

async function loadOrder(s: Session, id: string): Promise<Order | undefined> {
  return s.get<Order>('ORDER', id);
}

const isProducerOf = (actor: Organisation | undefined, o: Order) =>
  !!actor && (actor.role === 'operator' || (actor.role === 'producer' && actor.id === o.producerId));

/** Producer accepts a placed order. Reserves stock now unless a soft hold already did. */
export async function confirmOrder(s: Session, actor: Organisation | undefined, id: string): Promise<Result<{ order: Order }>> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const order = await loadOrder(s, id);
    if (!order) return fail(404, 'No such order');
    if (!isProducerOf(actor, order)) return fail(403, 'Only the producer can confirm this order');
    if (order.status !== 'placed') return fail(409, `This order is already ${order.status}`);
    const ctx = await load(s);
    const ops: TxItem[] = [orderUpdate(s, order, 'confirmed', 'reserved', actor!.id)];
    if (order.stock === 'none') {
      const windows = await readWindows(s, order);
      const short = shortfall(ctx, order, windows);
      if (short) return fail(409, `Not enough stock to confirm. ${short}. Raise the stock first, or decline.`);
      ops.push(...stockOps(s, ctx, order, windows, 'reserve'));
    }
    const tx = await s.transact(ops);
    if (tx.ok) return { ok: true, order: (await loadOrder(s, id))! };
  }
  return fail(409, 'The order changed at the same time; please look again');
}

async function release(s: Session, actor: Organisation, id: string, to: 'declined' | 'cancelled', note?: string, check?: (o: Order) => Result<never> | null): Promise<Result<{ order: Order }>> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const order = await loadOrder(s, id);
    if (!order) return fail(404, 'No such order');
    const denied = check?.(order);
    if (denied) return denied;
    const ctx = await load(s);
    const ops: TxItem[] = [orderUpdate(s, order, to, 'none', actor.id, note)];
    if (order.stock !== 'none') ops.push(...stockOps(s, ctx, order, await readWindows(s, order), 'release'));
    const tx = await s.transact(ops);
    if (tx.ok) return { ok: true, order: (await loadOrder(s, id))! };
  }
  return fail(409, 'The order changed at the same time; please look again');
}

export const declineOrder = (s: Session, actor: Organisation | undefined, id: string, reason?: unknown) =>
  actor
    ? release(s, actor, id, 'declined', typeof reason === 'string' ? reason.slice(0, 200) : undefined, (o) =>
      !isProducerOf(actor, o) ? fail(403, 'Only the producer can decline this order')
        : o.status !== 'placed' ? fail(409, `This order is already ${o.status}`) : null)
    : Promise.resolve(fail(403, 'Not signed in'));

/** Buyer withdraws an order up to the day before delivery (the operator may cancel at any time). */
export const cancelOrder = (s: Session, actor: Organisation | undefined, id: string) =>
  actor
    ? release(s, actor, id, 'cancelled', undefined, (o) =>
      !(actor.role === 'operator' || (actor.role === 'buyer' && actor.id === o.buyerId)) ? fail(403, 'Only the buyer can cancel this order')
        : o.status !== 'placed' && o.status !== 'confirmed' ? fail(409, `This order is already ${o.status}`)
          : actor.role === 'buyer' && o.deliveryDate <= todayIso() ? fail(409, 'Too late to cancel: delivery is today or has passed')
            : null)
    : Promise.resolve(fail(403, 'Not signed in'));
