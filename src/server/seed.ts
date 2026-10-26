import type {
  Category,
  Confidence,
  DriveDistances,
  Listing,
  Organisation,
  Product,
  SupplyWindow,
} from '../shared/types';
import organisationsJson from '../../data/organisations.json';
import { parseOrganisations } from './organisations';

/** Deterministic demo data, with all dates relative to `today`. */

const cat = (id: Category['id'], en: string, cy: string, maxDriveKm: number, deliveryDays: number[], leadDays: number): Category =>
  ({ id, name: { en, cy }, maxDriveKm, deliveryDays, leadDays });

export const CATEGORIES: Category[] = [
  cat('milk', 'Milk & cream', 'Llaeth a hufen', 20, [1, 2, 3, 4, 5, 6], 1),
  cat('bread', 'Bread & bakes', 'Bara a theisennau', 30, [1, 2, 3, 4, 5, 6], 1),
  cat('eggs', 'Eggs', 'Wyau', 40, [2, 4, 6], 1),
  cat('veg', 'Vegetables', 'Llysiau', 40, [2, 4, 6], 2),
  cat('fish', 'Fish & shellfish', 'Pysgod a physgod cregyn', 60, [2, 4, 5], 1),
  cat('meat', 'Meat', 'Cig', 60, [2, 4, 5], 2),
  cat('cheese', 'Cheese', 'Caws', 100, [3], 3),
];

const prod = (
  id: string, category: Product['category'], en: string, cy: string, unit: Product['unit'],
  allergens: string[] = [], season: number[] = [],
): Product => ({ id, category, name: { en, cy }, unit, allergens, season });

export const PRODUCTS: Product[] = [
  prod('milk-whole', 'milk', 'Whole milk', 'Llaeth cyflawn', 'litre', ['milk']),
  prod('milk-semi', 'milk', 'Semi-skimmed milk', 'Llaeth hanner sgim', 'litre', ['milk']),
  prod('cream-double', 'milk', 'Double cream', 'Hufen dwbl', 'litre', ['milk']),
  prod('eggs-free', 'eggs', 'Free-range eggs', 'Wyau buarth', 'dozen', ['egg']),
  prod('bread-sour', 'bread', 'Sourdough loaf', 'Torth surdoes', 'loaf', ['gluten']),
  prod('bara-brith', 'bread', 'Bara brith', 'Bara brith', 'each', ['gluten', 'egg']),
  prod('veg-leek', 'veg', 'Leeks', 'Cennin', 'kg', [], [9, 10, 11, 12, 1, 2, 3, 4]),
  prod('veg-potato', 'veg', 'Pembrokeshire earlies', 'Tatws cynnar Sir Benfro', 'kg', [], [5, 6, 7]),
  prod('veg-carrot', 'veg', 'Carrots', 'Moron', 'kg'),
  prod('veg-tomato', 'veg', 'Heritage tomatoes', 'Tomatos treftadaeth', 'kg', [], [7, 8, 9, 10]),
  prod('veg-kale', 'veg', 'Cavolo nero', 'Cavolo nero', 'kg', [], [9, 10, 11, 12, 1, 2, 3]),
  prod('meat-lamb', 'meat', 'Salt-marsh lamb shoulder', 'Ysgwydd oen morfa heli', 'kg'),
  prod('meat-beef', 'meat', 'Beef sirloin', 'Syrlwyn cig eidion', 'kg'),
  prod('meat-sausage', 'meat', 'Pork sausages', 'Selsig porc', 'kg', ['gluten']),
  prod('fish-crab', 'fish', 'Dressed crab', 'Cranc wedi’i ddresio', 'each', ['crustacean']),
  prod('fish-lobster', 'fish', 'Lobster', 'Cimwch', 'kg', ['crustacean']),
  prod('fish-bass', 'fish', 'Sea bass', 'Draenog môr', 'kg', ['fish']),
  prod('fish-mackerel', 'fish', 'Mackerel', 'Macrell', 'kg', ['fish']),
  prod('cheese-cheddar', 'cheese', 'Welsh cheddar', 'Cheddar Cymreig', 'kg', ['milk']),
  prod('cheese-blue', 'cheese', 'Blue cheese', 'Caws glas', 'kg', ['milk']),
];

// Organisations (and each producer's offers) are edited in data/organisations.json.
const loaded = parseOrganisations(organisationsJson, new Set(PRODUCTS.map((p) => p.id)));
export const ORGS: Organisation[] = loaded.orgs;
export const LISTINGS: Listing[] = loaded.listings;

const BASE_QTY: Record<Category['id'], number> = { milk: 200, bread: 40, eggs: 60, veg: 80, meat: 40, fish: 25, cheese: 30 };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

const WEEK_CONFIDENCE: Confidence[] = ['in_stock', 'in_stock', 'forecast', 'forecast', 'provisional', 'provisional'];

export function buildWindows(today: string): SupplyWindow[] {
  const byProduct = new Map(PRODUCTS.map((p) => [p.id, p]));
  const out: SupplyWindow[] = [];
  for (const l of LISTINGS) {
    const p = byProduct.get(l.productId)!;
    WEEK_CONFIDENCE.forEach((confidence, week) => {
      const start = addDays(today, week * 7);
      const month = Number(start.slice(5, 7));
      if (p.season.length && !p.season.includes(month)) return;
      const jitter = 0.6 + (hash(l.id + week) % 80) / 100; // 0.6 – 1.39
      const qtyTotal = Math.max(l.minOrder * 2, Math.round(BASE_QTY[p.category] * jitter));
      out.push({ listingId: l.id, start, end: addDays(start, 6), qtyTotal, qtyReserved: 0, confidence });
    });
  }
  return out;
}

const R = 6371;
function haversineKm(a: Organisation, b: Organisation): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Approximate drive distance: straight line × road factor (no live routing in the prototype). */
export function buildDistances(orgs: Organisation[] = ORGS, roadFactor = 1.35): DriveDistances {
  const d: DriveDistances = {};
  for (const a of orgs) {
    d[a.id] = {};
    for (const b of orgs) d[a.id][b.id] = a.id === b.id ? 0 : Math.round(haversineKm(a, b) * roadFactor);
  }
  return d;
}

export function buildSeed(today: string) {
  return {
    orgs: ORGS,
    categories: CATEGORIES,
    products: PRODUCTS,
    listings: LISTINGS,
    windows: buildWindows(today),
    distances: buildDistances(),
  };
}
export type Seed = ReturnType<typeof buildSeed>;
