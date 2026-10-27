import { deliveryFit, shelfLifeFor, type DeliveryFit } from '../shared/availability';
import { todayIso } from '../shared/dates';
import { deliveryRule, isUsualDay, ruleProblem } from '../shared/delivery';
import type { Bootstrap } from './api';

/**
 * What the screens say about a request's delivery day. Nothing here blocks anyone: a request for any future day is fine,
 * and a producer may offer a different day or a special delivery. These only decide which friendly note to show.
 */
const categoryOf = (boot: Bootstrap, productId: string) => {
  const product = boot.products.find((p) => p.id === productId);
  return product && boot.categories.find((c) => c.id === product.category);
};

/** Is the day the buyer needs it one the product is not normally delivered on, or at short notice? */
export function requestDateNote(boot: Bootstrap, productId: string, date: string): { kind: 'unusual' | 'short'; days: number } | undefined {
  const category = categoryOf(boot, productId);
  if (!category) return undefined;
  const rule = deliveryRule(boot.config, category);
  const problem = ruleProblem(rule, date, todayIso());
  if (problem === 'too_soon') return { kind: 'short', days: rule.lead };
  if (problem === 'not_delivery_day' || problem === 'not_hub_day' || problem === 'not_route_day' || problem === 'no_route') return { kind: 'unusual', days: rule.lead };
  return undefined;
}

/** Is `date` outside this producer's usual delivery days for this buyer? Then delivering then is a special delivery. */
export function isSpecialDelivery(boot: Bootstrap, productId: string, producerId: string, buyerId: string, date: string): boolean {
  const category = categoryOf(boot, productId);
  if (!category) return false;
  const listing = boot.listings.find((l) => l.producerId === producerId && l.productId === productId);
  const rule = deliveryRule(boot.config, category, listing, boot.orgs.find((o) => o.id === producerId), boot.orgs.find((o) => o.id === buyerId)?.area);
  return !isUsualDay(rule, date);
}

/** How well a delivery day suits the day needed, given how long this producer's product keeps. */
export function bidFit(boot: Bootstrap, productId: string, producerId: string, neededOn: string, deliveryDate: string): { fit: DeliveryFit; shelf: number } {
  const category = categoryOf(boot, productId);
  const listing = boot.listings.find((l) => l.producerId === producerId && l.productId === productId);
  const shelf = category ? shelfLifeFor(category, listing ?? {}) : 0;
  return { fit: deliveryFit(neededOn, deliveryDate, shelf), shelf };
}
