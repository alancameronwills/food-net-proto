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
