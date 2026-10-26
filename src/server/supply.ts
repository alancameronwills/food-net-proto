import { mondayOf } from '../shared/dates';
import type { ModelConfig } from '../shared/models';
import { reservableLimit } from '../shared/orders';
import type { Order, Organisation, SupplyWindow } from '../shared/types';
import type { Session } from './db';
import { emit } from './events';

/**
 * A producer has reduced a week's supply (lower quantity, or a firmer-to-looser confidence). If the stock
 * already promised to buyers no longer fits, flag the orders that no longer fit, oldest orders honoured first,
 * and tell those buyers. If a later edit makes room again, the flags clear themselves.
 * Returns how many orders are now flagged.
 */
export async function reviewSupplyCut(s: Session, config: ModelConfig, before: SupplyWindow | undefined, after: SupplyWindow): Promise<number> {
  const limitBefore = before ? reservableLimit(config, before) : Infinity;
  const limit = reservableLimit(config, after);
  const reduced = limit < limitBefore;
  const orders = (await s.list<Order>('ORDER'))
    .filter((o) => (o.status === 'placed' || o.status === 'confirmed') && o.stock !== 'none'
      && mondayOf(o.deliveryDate) === after.start && o.lines.some((l) => l.listingId === after.listingId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (orders.length === 0) return 0;

  let running = 0;
  let flagged = 0;
  const producer = await s.get<Organisation>('ORG', after.listingId.split(':')[0]);
  for (const o of orders) {
    const line = o.lines.find((l) => l.listingId === after.listingId)!;
    running += line.qty;
    const shortBy = Math.min(line.qty, Math.max(0, running - limit));
    const had = (o.flags ?? []).find((f) => f.listingId === after.listingId);
    const others = (o.flags ?? []).filter((f) => f.listingId !== after.listingId);
    if (shortBy > 0 && (reduced || had)) {
      flagged++;
      if (had?.shortBy === shortBy) continue;
      await s.updateIf('ORDER', o.id, { flags: [...others, { listingId: after.listingId, shortBy, at: new Date().toISOString() }] });
      if (!had) {
        const buyer = await s.get<Organisation>('ORG', o.buyerId);
        await emit(s, 'supply_cut', {
          orderId: o.id, buyer: buyer?.name, producer: producer?.name, productId: line.productId, qty: shortBy, date: o.deliveryDate,
        }, [o.buyerId]);
      }
    } else if (had) {
      await s.updateIf('ORDER', o.id, { flags: others });
    }
  }
  return flagged;
}
