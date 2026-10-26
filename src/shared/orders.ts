import { addDays, mondayOf } from './dates';
import { MAX_DAYS_AHEAD, leadDaysFor, ruleProblem, type DeliveryProblem, type DeliveryRule } from './delivery';
import { capabilities, localStatus, type ModelConfig } from './models';
import type { Category, Listing, SupplyWindow } from './types';

/** Largest quantity that may be reserved against a window under the active model. */
export function reservableLimit(config: ModelConfig, w: SupplyWindow): number {
  if (w.confidence === 'in_stock') return w.qtyTotal;
  if (w.confidence === 'provisional') return 0;
  return Math.floor(w.qtyTotal * capabilities(config).forecastCap);
}

export const windowKey = (listingId: string, deliveryDate: string) => `${listingId}#${mondayOf(deliveryDate)}`;

/** Price per unit for an order quantity: the best volume tier reached, when the model uses tiers. */
export function unitPriceFor(config: ModelConfig, listing: Listing, qty: number): number {
  if (!capabilities(config).volumeTiers || !listing.tiers?.length) return listing.pricePerUnit;
  const tier = [...listing.tiers].filter((t) => qty >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0];
  return tier ? tier.price : listing.pricePerUnit;
}

export const lineTotal = (unitPrice: number, qty: number) => Math.round(unitPrice * qty * 100) / 100;

export { MAX_DAYS_AHEAD, leadDaysFor };

/** Can this listing's category be delivered on `date` if the producer delivers by their own round? (No area or hub rules.) */
export function deliveryProblem(category: Category, listing: Listing, date: string, today: string): DeliveryProblem | null {
  return ruleProblem({ mode: 'producer', days: category.deliveryDays, lead: leadDaysFor(category, listing) }, date, today);
}

export type Unavailable =
  | DeliveryProblem
  | 'no_supply' | 'provisional' | 'forecast_blocked' | 'sold_out' | 'out_of_range';

export type Availability = {
  orderable: number;
  confidence?: SupplyWindow['confidence'];
  problem?: Unavailable;
  /** Set when orderable but outside the local range under the "warn only" model. */
  farWarning?: boolean;
};

/** Everything a buyer needs to know about ordering a listing for a date, in one place (used by UI and server). */
export function availabilityFor(args: {
  config: ModelConfig; category: Category; listing: Listing; window?: SupplyWindow;
  date: string; today: string; driveKm: number;
  /** Delivery rule for this producer and buyer under the active delivery model; defaults to the category's usual days. */
  rule?: DeliveryRule;
}): Availability {
  const { config, category, listing, window: w, date, today, driveKm } = args;
  const range = localStatus(config, category.maxDriveKm, driveKm);
  if (range === 'hidden') return { orderable: 0, problem: 'out_of_range' };
  const d = args.rule ? ruleProblem(args.rule, date, today) : deliveryProblem(category, listing, date, today);
  if (d) return { orderable: 0, problem: d };
  if (!w) return { orderable: 0, problem: 'no_supply' };
  const base = { confidence: w.confidence, farWarning: range === 'warn' };
  if (w.confidence === 'provisional') return { ...base, orderable: 0, problem: 'provisional' };
  if (w.confidence === 'forecast' && !capabilities(config).forecastOrderable) return { ...base, orderable: 0, problem: 'forecast_blocked' };
  const orderable = Math.max(0, reservableLimit(config, w) - w.qtyReserved);
  return orderable > 0 ? { ...base, orderable } : { ...base, orderable: 0, problem: 'sold_out' };
}

/** Earliest date on or after `from` that falls on one of the given weekdays (0 = Sunday). */
export function nextWeekday(from: string, days: number[]): string {
  for (let i = 0; i < 8; i++) {
    const d = addDays(from, i);
    if (days.includes(new Date(d + 'T00:00:00Z').getUTCDay())) return d;
  }
  return from;
}
