import { addDays } from './dates';
import type { ModelConfig } from './models';
import type { Area, Category, Listing, Order, Organisation } from './types';

export const MAX_DAYS_AHEAD = 180;
/** The hub courier needs this many days' notice to collect from producers and plan the round. */
export const HUB_LEAD_DAYS = 2;

export type DeliveryMode = NonNullable<Order['deliveryMode']>;
export type DeliveryProblem = 'not_delivery_day' | 'too_soon' | 'too_far' | 'no_route' | 'not_route_day' | 'not_hub_day';

/** On which weekdays, and with how much notice, can something be delivered? Depends on the delivery model. */
export type DeliveryRule = { mode: DeliveryMode; days: number[]; lead: number };

export const leadDaysFor = (category: Category, listing?: Pick<Listing, 'leadDays'>) => listing?.leadDays ?? category.leadDays;

/**
 * The delivery rule for one product from one producer to one buyer.
 * - producer delivers: the product's usual delivery days (milk most days, cheese weekly)
 * - area days: the producer's published round for the buyer's area
 * - hub courier: the hub's run days, with extra notice for collection
 */
export function deliveryRule(
  config: ModelConfig, category: Category, listing?: Pick<Listing, 'leadDays'>, producer?: Organisation, buyerArea?: string,
): DeliveryRule {
  const lead = leadDaysFor(category, listing);
  if (config.delivery === 'hub_courier') return { mode: 'hub_courier', days: config.hubDays, lead: Math.max(lead, HUB_LEAD_DAYS) };
  if (config.delivery === 'area_days' && producer?.routes) {
    return { mode: 'area_days', days: (buyerArea && producer.routes[buyerArea]) || [], lead };
  }
  return { mode: config.delivery === 'area_days' ? 'area_days' : 'producer', days: category.deliveryDays, lead };
}

export function ruleProblem(rule: DeliveryRule, date: string, today: string): DeliveryProblem | null {
  if (date < addDays(today, rule.lead)) return 'too_soon';
  if (date > addDays(today, MAX_DAYS_AHEAD)) return 'too_far';
  if (rule.mode === 'area_days' && rule.days.length === 0) return 'no_route';
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  if (rule.days.includes(dow)) return null;
  return rule.mode === 'hub_courier' ? 'not_hub_day' : rule.mode === 'area_days' ? 'not_route_day' : 'not_delivery_day';
}

export const WEEKDAYS = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], cy: ['Sul', 'Llun', 'Maw', 'Mer', 'Iau', 'Gwe', 'Sad'] } as const;
export const dayNames = (days: number[], lang: 'en' | 'cy') => [...days].sort().map((d) => WEEKDAYS[lang][d]).join(', ');

/** The area whose centre is nearest to a location. */
export function nearestArea(areas: Area[], lat: number, lon: number): string | undefined {
  const d2 = (a: Area) => (a.lat - lat) ** 2 + ((a.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
  return [...areas].sort((a, b) => d2(a) - d2(b))[0]?.id;
}

// ---- run sheets ---------------------------------------------------------------------------------

export type RunStop = {
  buyerId: string; area?: string; orderIds: string[];
  /** What goes to this buyer, with which producer it comes from (several producers means several vans unless the hub consolidates). */
  lines: { producerId: string; productId: string; qty: number; note?: string }[];
};
export type Run = { date: string; stops: RunStop[]; /** Deliveries if every producer drives separately, vs one drop per buyer. */ separateDrops: number; consolidatedDrops: number };

const LIVE: Order['status'][] = ['placed', 'confirmed', 'picked'];

/** Group orders still to be delivered by date, then by buyer. Used for producer run sheets and the operator's hub view. */
export function buildRuns(orders: Order[], orgs: Organisation[], opts: { includePlaced?: boolean } = {}): Run[] {
  const byOrg = new Map(orgs.map((o) => [o.id, o]));
  const live = orders.filter((o) => (opts.includePlaced ? LIVE : ['confirmed', 'picked']).includes(o.status));
  const dates = [...new Set(live.map((o) => o.deliveryDate))].sort();
  return dates.map((date) => {
    const todays = live.filter((o) => o.deliveryDate === date);
    const buyers = [...new Set(todays.map((o) => o.buyerId))];
    const stops: RunStop[] = buyers.map((buyerId) => {
      const mine = todays.filter((o) => o.buyerId === buyerId);
      return {
        buyerId, area: byOrg.get(buyerId)?.area, orderIds: mine.map((o) => o.id),
        lines: mine.flatMap((o) => o.lines.map((l) => ({ producerId: o.producerId, productId: l.productId, qty: l.qty, ...(l.note ? { note: l.note } : {}) }))),
      };
    }).sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.buyerId.localeCompare(b.buyerId));
    return {
      date, stops,
      separateDrops: new Set(todays.map((o) => `${o.buyerId}|${o.producerId}`)).size,
      consolidatedDrops: buyers.length,
    };
  });
}
