import { addDays } from './dates';
import { MAX_DAYS_AHEAD, isUsualDay, type DeliveryRule } from './delivery';
import type { ModelConfig } from './models';
import { availabilityFor, windowKey } from './orders';
import type { Category, Confidence, Listing, SupplyWindow } from './types';

export const MAX_SHELF_LIFE_DAYS = 730;

/** How long after delivery a product stays good: the producer's setting for this listing, else the category's usual. */
export const shelfLifeFor = (category: Pick<Category, 'shelfLifeDays'>, listing: Pick<Listing, 'shelfLifeDays'>): number =>
  listing.shelfLifeDays ?? category.shelfLifeDays;

/** A plain-language length of time: "2 days", "3 weeks", "2 months". */
export function describeDays(days: number): { unit: 'day' | 'week' | 'month'; n: number } {
  if (days >= 60 && days % 30 === 0) return { unit: 'month', n: days / 30 };
  if (days >= 14 && days % 7 === 0) return { unit: 'week', n: days / 7 };
  if (days >= 60) return { unit: 'month', n: Math.round(days / 30) };
  return { unit: 'day', n: days };
}

/** A day on which this product could be delivered to this buyer, with stock to order. */
export type Deliverable = { date: string; orderable: number; confidence: Confidence; farWarning?: boolean; /** a one-off delivery the producer has added, not one of their usual days */ special?: boolean };

/** Every day from tomorrow on that this listing can be delivered to this buyer with stock to order (under the active models). */
export function deliverableDates(a: {
  config: ModelConfig; category: Category; listing: Listing; rule: DeliveryRule; driveKm: number;
  windows: Map<string, SupplyWindow>; today: string;
}): Deliverable[] {
  const out: Deliverable[] = [];
  for (let i = 1; i <= MAX_DAYS_AHEAD; i++) {
    const date = addDays(a.today, i);
    const av = availabilityFor({
      config: a.config, category: a.category, listing: a.listing, window: a.windows.get(windowKey(a.listing.id, date)),
      date, today: a.today, driveKm: a.driveKm, rule: a.rule,
    });
    if (!av.problem && av.orderable > 0) {
      out.push({ date, orderable: av.orderable, confidence: av.confidence!, farWarning: av.farWarning, ...(isUsualDay(a.rule, date) ? {} : { special: true }) });
    }
  }
  return out;
}

export type UseAvailability =
  | { ok: true; shelfLife: number; /** the freshest delivery day that works */ best: Deliverable; /** every delivery day that works */ options: Deliverable[] }
  | { ok: false; shelfLife: number; /** latest day before the chosen one the product could be used */ earlier?: string; /** earliest day after it */ later?: string };

/**
 * Can the buyer have this on the day they need it? Goods are fine if they are delivered no earlier than
 * `shelfLife` days before the day of use (and, of course, no later than it). When they cannot, say which days
 * either side would work.
 */
export function availableForUse(delivery: Deliverable[], shelfLife: number, useOn: string): UseAvailability {
  const options = delivery.filter((d) => d.date <= useOn && d.date >= addDays(useOn, -shelfLife));
  if (options.length > 0) return { ok: true, shelfLife, best: options[options.length - 1], options };
  let earlier: string | undefined;
  let later: string | undefined;
  for (const d of delivery) {
    const lastUse = addDays(d.date, shelfLife);
    if (lastUse < useOn && (!earlier || lastUse > earlier)) earlier = lastUse;
    if (d.date > useOn && (!later || d.date < later)) later = d.date;
  }
  return { ok: false, shelfLife, earlier, later };
}

/**
 * How well a delivery day suits the day the goods are needed.
 * - on_day: delivered the day it is needed
 * - early: earlier, but still within the product's shelf life, so fine
 * - too_early: earlier than the shelf life allows, so it may not last until the day needed
 * - late: after the day it is needed
 */
export type DeliveryFit = 'on_day' | 'early' | 'too_early' | 'late';
export function deliveryFit(neededOn: string, deliveryDate: string, shelfLife: number): DeliveryFit {
  if (deliveryDate === neededOn) return 'on_day';
  if (deliveryDate > neededOn) return 'late';
  return deliveryDate >= addDays(neededOn, -shelfLife) ? 'early' : 'too_early';
}
