import { localStatus, type ModelConfig } from './models';
import { reservableLimit } from './orders';
import { deliveryRule, type DeliveryRule } from './delivery';
import type { Category, DriveDistances, Listing, Organisation, Product, SupplyWindow } from './types';

export type Offer = {
  listing: Listing;
  product: Product;
  producer: Organisation;
  category: Category;
  driveKm: number;
  limitKm: number;
  status: 'ok' | 'warn' | 'hidden';
  /** When this can be delivered to this buyer, under the active delivery model. */
  rule: DeliveryRule;
};

/** All listings with their local-range status relative to a buyer's site, under the active model. */
export function offersFor(
  buyerId: string,
  data: {
    config: ModelConfig; orgs: Organisation[]; categories: Category[]; products: Product[];
    listings: Listing[]; distances: DriveDistances;
  },
): Offer[] {
  const orgs = new Map(data.orgs.map((o) => [o.id, o]));
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const prods = new Map(data.products.map((p) => [p.id, p]));
  const out: Offer[] = [];
  for (const listing of data.listings) {
    const product = prods.get(listing.productId);
    const producer = orgs.get(listing.producerId);
    const category = product && cats.get(product.category);
    const driveKm = data.distances[buyerId]?.[listing.producerId];
    if (!product || !producer || !category || driveKm === undefined) continue;
    const status = localStatus(data.config, category.maxDriveKm, driveKm);
    const limitKm = data.config.localRange === 'flat' ? data.config.flatRadiusKm : category.maxDriveKm;
    out.push({ listing, product, producer, category, driveKm, limitKm, status, rule: deliveryRule(data.config, category, listing, producer, orgs.get(buyerId)?.area) });
  }
  return out.sort((a, b) => a.category.id.localeCompare(b.category.id) || a.driveKm - b.driveKm);
}

/**
 * Quantity buyers may still order from a window under the active model: all free stock when in stock,
 * a share of forecast (per the forecast-ordering model), and nothing while provisional.
 */
export function orderableQty(config: ModelConfig, w: SupplyWindow): number {
  return Math.max(0, reservableLimit(config, w) - w.qtyReserved);
}
