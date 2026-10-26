import type {
  Category,
  Confidence,
  DriveDistances,
  Listing,
  Organisation,
  Product,
  SupplyWindow,
} from '../shared/types';

/** Deterministic demo data, with all dates relative to `today`. */

const org = (
  id: string, role: Organisation['role'], name: string, kind: string, town: string,
  lat: number, lon: number, en: string, cy: string,
): Organisation => ({ id, role, name, kind, town, lat, lon, blurb: { en, cy } });

export const ORGS: Organisation[] = [
  org('harbour-bistro', 'buyer', 'Harbour Bistro', 'restaurant', 'Fishguard', 52.0, -4.98,
    'Seafront bistro with a daily-changing menu.', 'Bistro glan môr gyda bwydlen sy’n newid bob dydd.'),
  org('grand-hotel', 'buyer', 'Grand Hotel', 'hotel', 'Tenby', 51.673, -4.702,
    '80-bedroom hotel with a busy breakfast and banqueting trade.', 'Gwesty 80 ystafell gyda brecwast prysur a gwleddoedd.'),
  org('corner-deli', 'buyer', 'Corner Deli', 'retailer', 'Narberth', 51.798, -4.742,
    'Independent delicatessen and village shop.', 'Delicatessen annibynnol a siop pentref.'),
  org('castle-caterers', 'buyer', 'Castle Caterers', 'caterer', 'Pembroke', 51.675, -4.915,
    'Weddings and events across the county.', 'Priodasau a digwyddiadau ar draws y sir.'),
  org('preseli-hill-farm', 'producer', 'Preseli Hill Farm', 'farm', 'Crymych', 51.98, -4.65,
    'Upland lamb, beef and root vegetables.', 'Oen, cig eidion a llysiau gwraidd o’r ucheldir.'),
  org('dyfed-dairy', 'producer', 'Dyfed Dairy', 'dairy', 'Newport', 52.02, -4.84,
    'Family dairy: milk, cream, eggs and cheddar.', 'Llaethdy teuluol: llaeth, hufen, wyau a cheddar.'),
  org('cleddau-creamery', 'producer', 'Cleddau Creamery', 'dairy', 'Templeton', 51.78, -4.76,
    'Small creamery making milk, cream and blue cheese.', 'Hufenfa fach yn gwneud llaeth, hufen a chaws glas.'),
  org('solva-catch', 'producer', 'Solva Catch', 'fisher', 'Solva', 51.88, -5.2,
    'Day-boat crab, lobster and line-caught fish.', 'Cranc, cimwch a physgod llinell o’r cwch dydd.'),
  org('haverfordwest-bakery', 'producer', 'Haverfordwest Bakery', 'baker', 'Haverfordwest', 51.80, -4.97,
    'Sourdough and traditional Welsh bakes.', 'Surdoes a nwyddau pobi Cymreig traddodiadol.'),
  org('castlemorris-garden', 'producer', 'Castlemorris Market Garden', 'farm', 'Castlemorris', 51.95, -5.05,
    'Seasonal vegetables, salads and free-range eggs.', 'Llysiau tymhorol, saladau a wyau buarth.'),
  org('pembroke-butchers', 'producer', 'Pembroke Butchers', 'butcher', 'Pembroke Dock', 51.69, -4.94,
    'Local lamb, beef and sausages.', 'Oen, cig eidion a selsig lleol.'),
  org('angle-bay-seafood', 'producer', 'Angle Bay Seafood Packers', 'packer', 'Angle', 51.68, -5.08,
    'Packing and processing local shellfish and fish.', 'Pacio a phrosesu pysgod cregyn a physgod lleol.'),
  org('teifi-valley-cheese', 'producer', 'Teifi Valley Cheese', 'dairy', 'Newcastle Emlyn', 52.04, -4.47,
    'Farmhouse cheeses and a little milk.', 'Cawsiau fferm ac ychydig o laeth.'),
  org('operator', 'operator', 'Bwyd Lleol Sir Benfro', 'network', 'Haverfordwest', 51.80, -4.97,
    'Network operator: onboarding, models and oversight.', 'Gweithredwr y rhwydwaith: ymuno, modelau a goruchwylio.'),
];

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

/** producerId -> [productId, price per unit, min order][] */
const OFFERS: Record<string, [string, number, number][]> = {
  'preseli-hill-farm': [['meat-lamb', 14.5, 2], ['meat-beef', 24, 2], ['veg-leek', 2.4, 5], ['veg-potato', 1.8, 10], ['veg-carrot', 1.2, 10]],
  'dyfed-dairy': [['milk-whole', 0.95, 10], ['milk-semi', 0.9, 10], ['cream-double', 4.2, 2], ['cheese-cheddar', 13, 1], ['eggs-free', 3.4, 5]],
  'cleddau-creamery': [['milk-whole', 1.0, 10], ['cream-double', 4.5, 2], ['cheese-blue', 18, 1]],
  'solva-catch': [['fish-crab', 6.5, 6], ['fish-lobster', 38, 2], ['fish-bass', 21, 2], ['fish-mackerel', 7.5, 3]],
  'haverfordwest-bakery': [['bread-sour', 3.6, 6], ['bara-brith', 4.5, 4]],
  'castlemorris-garden': [['veg-leek', 2.2, 5], ['veg-carrot', 1.1, 10], ['veg-tomato', 6.8, 3], ['veg-kale', 4.5, 2], ['eggs-free', 3.2, 5]],
  'pembroke-butchers': [['meat-lamb', 15.2, 2], ['meat-beef', 25, 2], ['meat-sausage', 9.8, 3]],
  'angle-bay-seafood': [['fish-crab', 6.2, 12], ['fish-mackerel', 7, 5], ['fish-bass', 20, 3]],
  'teifi-valley-cheese': [['cheese-cheddar', 12.5, 1], ['cheese-blue', 17, 1], ['milk-whole', 0.9, 20]],
};

export const LISTINGS: Listing[] = Object.entries(OFFERS).flatMap(([producerId, rows]) =>
  rows.map(([productId, pricePerUnit, minOrder]) => ({
    id: `${producerId}:${productId}`,
    producerId,
    productId,
    pricePerUnit,
    minOrder,
    certifications: producerId === 'castlemorris-garden' ? ['organic'] : producerId === 'solva-catch' ? ['msc-line-caught'] : [],
  })),
);

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
