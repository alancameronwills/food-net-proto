import { isIsoDate, todayIso } from '../shared/dates';
import { capabilities } from '../shared/models';
import { availabilityFor, lineTotal, reservableLimit, unitPriceFor, windowKey, type Unavailable } from '../shared/orders';
import type { Order, OrderLine, OrderStatus, Organisation, StockState, SupplyWindow } from '../shared/types';
import type { Session, TxItem } from './db';
import { emit, type EventParams, type EventType } from './events';
import type { Result } from './producer';
import { deliveryRule, isUsualDay } from '../shared/delivery';
import { getConfig, getDistances, listCategories, listExtraDays, listListings, listOrgs, listProducts } from './store';

const fail = (status: 400 | 403 | 404 | 409, error: string): Result<never> => ({ ok: false, status, error });
const MAX_LINES = 25; // a transaction holds at most 100 items; one order never gets near that
const RETRIES = 3;

const REASON: Record<Unavailable, string> = {
  not_delivery_day: 'is not delivered on that day',
  no_route: 'is not delivered to your area by this producer',
  not_route_day: 'is not on this producer\'s delivery round to your area that day',
  not_hub_day: 'is not on a hub courier day',
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
  const [config, categories, products, listings, distances, orgs, extras] = await Promise.all([
    getConfig(s), listCategories(s), listProducts(s), listListings(s), getDistances(s), listOrgs(s), listExtraDays(s),
  ]);
  const extraDates = (producerId: string) => extras.filter((e) => e.producerId === producerId).map((e) => e.date);
  return {
    config,
    extraDates,
    orgs: new Map(orgs.map((o) => [o.id, o])),
    categories: new Map(categories.map((c) => [c.id, c])),
    products: new Map(products.map((p) => [p.id, p])),
    listings: new Map(listings.map((l) => [l.id, l])),
    distances,
  };
}
type Ctx = Awaited<ReturnType<typeof load>>;

const nowIso = () => new Date().toISOString();

/** Tell people about something that happened to an order. Never lets a notification problem undo the order itself. */
async function announce(s: Session, type: EventType, o: Order, extra: EventParams = {}, to: ('buyer' | 'producer')[] = []) {
  try {
    const [buyer, producer] = await Promise.all([s.get<Organisation>('ORG', o.buyerId), s.get<Organisation>('ORG', o.producerId)]);
    const first = o.lines[0];
    await emit(s, type, {
      orderId: o.id, buyer: buyer?.name, producer: producer?.name, date: o.deliveryDate,
      ...(o.lines.length === 1 ? { productId: first.productId, qty: first.qty } : {}), ...extra,
    }, to.map((who) => (who === 'buyer' ? o.buyerId : o.producerId)));
  } catch (e) {
    console.error('announce failed', e);
  }
}

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
export type Placed = { orders: Order[]; failed: { producerId: string; deliveryDate: string; error: string }[] };

/**
 * Place a checkout. Every line carries its own delivery day and its own note for the producer. Each line is
 * checked against live stock and the delivery rules; the checkout is then split into one order per producer
 * and delivery day, and (depending on the stock model) stock is held or reserved atomically for each.
 * (A top-level `deliveryDate` is accepted as the day for any line that does not give its own.)
 */
export async function placeOrders(s: Session, actor: Organisation | undefined, body: PlaceBody): Promise<Result<Placed>> {
  if (actor?.role !== 'buyer') return fail(403, 'Only buyers can place orders');
  if (!Array.isArray(body.lines) || body.lines.length === 0) return fail(400, 'Your basket is empty');
  if (body.lines.length > MAX_LINES) return fail(400, `At most ${MAX_LINES} items per checkout`);
  const orderNote = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;

  const ctx = await load(s);
  const today = todayIso();
  type Want = { listingId: string; deliveryDate: string; qty: number; note?: string };
  const merged = new Map<string, Want>();
  for (const raw of body.lines as { listingId?: unknown; qty?: unknown; deliveryDate?: unknown; note?: unknown }[]) {
    if (typeof raw?.listingId !== 'string' || !Number.isInteger(raw.qty) || (raw.qty as number) <= 0) return fail(400, 'Each line needs a listingId and a whole quantity');
    const deliveryDate = raw.deliveryDate ?? body.deliveryDate;
    if (!isIsoDate(deliveryDate)) return fail(400, 'Each item needs a delivery date (YYYY-MM-DD)');
    const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 300) : undefined;
    const key = `${raw.listingId}@${deliveryDate}`;
    const have = merged.get(key);
    merged.set(key, { listingId: raw.listingId, deliveryDate, qty: (have?.qty ?? 0) + (raw.qty as number), note: have?.note ?? note });
  }

  const byOrder = new Map<string, { producerId: string; deliveryDate: string; lines: OrderLine[]; usual: boolean[] }>();
  const windows = new Map<string, SupplyWindow>();
  for (const want of merged.values()) {
    const { listingId, deliveryDate, qty } = want;
    const listing = ctx.listings.get(listingId);
    const product = listing && ctx.products.get(listing.productId);
    const category = product && ctx.categories.get(product.category);
    if (!listing || !product || !category) return fail(404, 'A product in your basket is no longer sold');
    if (qty < listing.minOrder) return fail(400, `${product.name.en}: minimum order is ${listing.minOrder}`);
    const w = await s.get<SupplyWindow>('WINDOW', winSk(listingId, deliveryDate));
    if (w) windows.set(winSk(listingId, deliveryDate), w);
    const rule = deliveryRule(ctx.config, category, listing, ctx.orgs.get(listing.producerId), ctx.orgs.get(actor.id)?.area, ctx.extraDates(listing.producerId));
    const av = availabilityFor({
      config: ctx.config, category, listing, window: w, date: deliveryDate, today,
      driveKm: ctx.distances[actor.id]?.[listing.producerId] ?? Infinity, rule,
    });
    if (av.problem) return fail(409, `${product.name.en} ${REASON[av.problem]} (${deliveryDate})`);
    if (qty > av.orderable) return fail(409, `${product.name.en}: only ${av.orderable} available on ${deliveryDate}`);
    const unitPrice = unitPriceFor(ctx.config, listing, qty);
    const key = `${listing.producerId}|${deliveryDate}`;
    const entry = byOrder.get(key) ?? { producerId: listing.producerId, deliveryDate, lines: [], usual: [] };
    entry.usual.push(isUsualDay(rule, deliveryDate));
    entry.lines.push({ listingId, productId: product.id, qty, unitPrice, ...(want.note ? { note: want.note } : {}) });
    byOrder.set(key, entry);
  }

  const caps = capabilities(ctx.config);
  const groupId = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const result: Placed = { orders: [], failed: [] };
  for (const { producerId, deliveryDate, lines, usual } of byOrder.values()) {
    const seq = await s.nextSeq('META', 'order-seq');
    const autoConfirm = !caps.producerConfirmsOrders; // "on placement": accepted automatically
    const stock: StockState = autoConfirm ? 'reserved' : caps.softHoldOnPlace ? 'held' : 'none';
    const status: OrderStatus = autoConfirm ? 'confirmed' : 'placed';
    const at = nowIso();
    const order: Order = {
      id: `BL-${1000 + seq}`, groupId, buyerId: actor.id, producerId, deliveryDate, status, stock, lines, deliveryMode: ctx.config.delivery as Order['deliveryMode'],
      // a delivery on none of the producer's usual days for these goods is a special one (the producer added the day)
      ...(usual.some(Boolean) ? {} : { special: true }),
      total: Math.round(lines.reduce((n, l) => n + lineTotal(l.unitPrice, l.qty), 0) * 100) / 100,
      ...(orderNote ? { note: orderNote } : {}), createdAt: at, history: [{ at, status, by: actor.id }],
    };
    const err = await writeNewOrder(s, ctx, order, windows);
    if (err) { result.failed.push({ producerId, deliveryDate, error: err }); continue; }
    result.orders.push(order);
    await announce(s, 'order_placed', order, {}, ['producer']);
    if (order.status === 'confirmed') await announce(s, 'order_confirmed', order, {}, ['buyer']);
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
/** Move an order to a new status (only if it is still in the state we read), recording who did it. */
function orderUpdate(s: Session, order: Order, to: OrderStatus, stock: StockState, by: string, note?: string, extra: Record<string, unknown> = {}): TxItem {
  const entry = { at: nowIso(), status: to, by, ...(note ? { note } : {}) };
  const extraKeys = Object.keys(extra);
  return s.tUpdate('ORDER', order.id,
    'SET #st = :to, #sk = :stock, #ua = :at, #h = list_append(#h, :entry)' + extraKeys.map((k) => `, #x_${k} = :x_${k}`).join(''),
    { ...names, ...Object.fromEntries(extraKeys.map((k) => [`#x_${k}`, k])) },
    { ':to': to, ':stock': stock, ':at': entry.at, ':entry': [entry], ':from': order.status, ':oldstock': order.stock,
      ...Object.fromEntries(extraKeys.map((k) => [`:x_${k}`, extra[k]])) },
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
    if (tx.ok) {
      const done = (await loadOrder(s, id))!;
      await announce(s, 'order_confirmed', done, {}, ['buyer']);
      return { ok: true, order: done };
    }
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
    if (tx.ok) {
      const done = (await loadOrder(s, id))!;
      if (to === 'declined') await announce(s, 'order_declined', done, note ? { reason: note } : {}, ['buyer']);
      else await announce(s, 'order_cancelled', done, {}, ['producer']);
      return { ok: true, order: done };
    }
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

// ---- fulfilment ----------------------------------------------------------------------------------

/** Producer has the order ready. */
export async function pickOrder(s: Session, actor: Organisation | undefined, id: string): Promise<Result<{ order: Order }>> {
  const order = await loadOrder(s, id);
  if (!order) return fail(404, 'No such order');
  if (!isProducerOf(actor, order)) return fail(403, 'Only the producer can do this');
  if (order.status !== 'confirmed') return fail(409, `Only a confirmed order can be marked as picked (this one is ${order.status})`);
  const tx = await s.transact([orderUpdate(s, order, 'picked', order.stock, actor!.id)]);
  if (!tx.ok) return fail(409, 'The order changed at the same time; please look again');
  const done = (await loadOrder(s, id))!;
  await announce(s, 'order_picked', done, {}, ['buyer']);
  return { ok: true, order: done };
}

/**
 * Record what was actually delivered. Delivering everything makes the order `delivered`; any shortfall makes it `short`.
 * Reserved stock stays reserved (it has been used), so a short delivery does not put the shortfall back on sale.
 */
export async function deliverOrder(s: Session, actor: Organisation | undefined, id: string, lines?: unknown): Promise<Result<{ order: Order }>> {
  const order = await loadOrder(s, id);
  if (!order) return fail(404, 'No such order');
  if (!isProducerOf(actor, order)) return fail(403, 'Only the producer can do this');
  if (order.status !== 'confirmed' && order.status !== 'picked') return fail(409, `Only a confirmed or picked order can be delivered (this one is ${order.status})`);

  const given = new Map<string, number>();
  if (lines !== undefined) {
    if (!Array.isArray(lines)) return fail(400, 'lines must be a list');
    for (const l of lines as { listingId?: unknown; qty?: unknown }[]) {
      if (typeof l?.listingId !== 'string' || !Number.isInteger(l.qty) || (l.qty as number) < 0) return fail(400, 'Each delivered line needs a listingId and a whole quantity');
      given.set(l.listingId, l.qty as number);
    }
  }
  const delivered = order.lines.map((l) => ({ listingId: l.listingId, qty: given.get(l.listingId) ?? l.qty }));
  for (const d of delivered) {
    const ordered = order.lines.find((l) => l.listingId === d.listingId)!.qty;
    if (d.qty > ordered) return fail(400, 'You cannot deliver more than was ordered');
  }
  const short = delivered.some((d, i) => d.qty < order.lines[i].qty);
  const deliveredTotal = Math.round(delivered.reduce((n, d, i) => n + lineTotal(order.lines[i].unitPrice, d.qty), 0) * 100) / 100;
  const status: OrderStatus = short ? 'short' : 'delivered';
  const tx = await s.transact([orderUpdate(s, order, status, order.stock, actor!.id, undefined, { delivered, deliveredTotal })]);
  if (!tx.ok) return fail(409, 'The order changed at the same time; please look again');
  const done = (await loadOrder(s, id))!;
  await announce(s, short ? 'order_short' : 'order_delivered', done, short ? { price: deliveredTotal } : {}, ['buyer']);
  return { ok: true, order: done };
}

/** The buyer has seen the "supply was reduced" warning and keeps the order anyway. */
export async function dismissFlags(s: Session, actor: Organisation | undefined, id: string): Promise<Result<{ order: Order }>> {
  const order = await loadOrder(s, id);
  if (!order) return fail(404, 'No such order');
  if (!(actor?.role === 'operator' || (actor?.role === 'buyer' && actor.id === order.buyerId))) return fail(403, 'Only the buyer can do this');
  await s.updateIf('ORDER', id, { flags: [] });
  return { ok: true, order: (await loadOrder(s, id))! };
}
