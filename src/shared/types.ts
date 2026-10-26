export type Role = 'buyer' | 'producer' | 'operator';
export type Lang = 'en' | 'cy';
export type Bilingual = { en: string; cy: string };

export type Organisation = {
  id: string;
  role: Role;
  name: string;
  /** e.g. restaurant, hotel, retailer, caterer, farm, fisher, butcher, baker, dairy, packer */
  kind: string;
  town: string;
  lat: number;
  lon: number;
  blurb: Bilingual;
};

export type CategoryId = 'milk' | 'eggs' | 'bread' | 'veg' | 'meat' | 'fish' | 'cheese';

/** Per-category "local" rule and typical delivery pattern. */
export type Category = {
  id: CategoryId;
  name: Bilingual;
  maxDriveKm: number;
  /** Days of week deliveries typically run (0 = Sunday). */
  deliveryDays: number[];
  /** Minimum days notice a producer typically needs. */
  leadDays: number;
};

export type Unit = 'litre' | 'kg' | 'dozen' | 'loaf' | 'each' | 'crate';

export type Product = {
  id: string;
  category: CategoryId;
  name: Bilingual;
  unit: Unit;
  allergens: string[];
  /** Months (1-12) in season; empty = all year. */
  season: number[];
};

export type Listing = {
  id: string;
  producerId: string;
  productId: string;
  pricePerUnit: number; // GBP
  minOrder: number;
  leadDays?: number; // overrides category default
  /** Volume tiers (used when the pricing model is `tiers`): order >= minQty pays `price` per unit. */
  tiers?: { minQty: number; price: number }[];
  certifications: string[];
};

export type Confidence = 'in_stock' | 'forecast' | 'provisional';

/** Quantity of a listing available for delivery over a date range. */
export type SupplyWindow = {
  listingId: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  qtyTotal: number;
  qtyReserved: number;
  confidence: Confidence;
};

export type DriveDistances = Record<string, Record<string, number>>; // km, orgId -> orgId -> km

export type Persona = Pick<Organisation, 'id' | 'role' | 'name' | 'kind' | 'town' | 'blurb'>;

/** declined = producer said no; cancelled = buyer (or operator) withdrew. */
export type OrderStatus = 'placed' | 'confirmed' | 'declined' | 'cancelled';
/** Whether the order currently holds stock: none, a soft hold awaiting confirmation, or firmly reserved. */
export type StockState = 'none' | 'held' | 'reserved';

export type OrderLine = { listingId: string; productId: string; qty: number; unitPrice: number };

/** One order is always between one buyer and one producer; a checkout with several producers makes several orders sharing a groupId. */
export type Order = {
  id: string; // display reference, e.g. BL-1001
  groupId: string;
  buyerId: string;
  producerId: string;
  deliveryDate: string; // YYYY-MM-DD
  status: OrderStatus;
  stock: StockState;
  lines: OrderLine[];
  total: number;
  note?: string;
  createdAt: string; // ISO timestamp
  history: { at: string; status: OrderStatus; by: string; note?: string }[];
};
