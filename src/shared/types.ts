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
  /** Producers only: shown as a "verified member" badge under the badges trust model. */
  verified?: boolean;
  /** Producers only: past delivery record before this session, so reliability scores are meaningful from the start. */
  baseline?: { orders: number; fillRate: number };
  /** Worked out from the location: which delivery area this organisation is in (see data/areas.json). */
  area?: string;
  /** Producers only: weekdays (0 = Sunday) on which they run a delivery round to each area. None given = any category delivery day. */
  routes?: Record<string, number[]>;
};

/** A zone producers publish delivery rounds for; every organisation belongs to the nearest one. */
export type Area = { id: string; name: Bilingual; lat: number; lon: number };

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
  /** How many days after delivery the goods stay good, unless the producer sets their own for a listing. */
  shelfLifeDays: number;
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
  /** Days after delivery the goods stay good; the producer's own figure, else the category's. */
  shelfLifeDays?: number;
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

/** declined = producer said no; cancelled = buyer (or operator) withdrew; short = delivered, but less than ordered. */
export type OrderStatus = 'placed' | 'confirmed' | 'picked' | 'delivered' | 'short' | 'declined' | 'cancelled';
/** Whether the order currently holds stock: none, a soft hold awaiting confirmation, or firmly reserved. */
export type StockState = 'none' | 'held' | 'reserved';

/** `note` is for the producer, about this item only. */
export type OrderLine = { listingId: string; productId: string; qty: number; unitPrice: number; note?: string };

/** One order is always between one buyer and one producer for one delivery day; a checkout with several producers or several days makes several orders sharing a groupId. */
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
  /** How it is being delivered, fixed when the order was placed. */
  deliveryMode?: 'producer' | 'area_days' | 'hub_courier';
  /** Set when the order arises from accepting a bid on a demand request. */
  source?: { requestId: string; bidId: string };
  /** Quantities actually delivered, once delivery is recorded. */
  delivered?: { listingId: string; qty: number }[];
  deliveredTotal?: number;
  /** Supply behind this order was reduced after it was placed; the buyer decides what to do. */
  flags?: { listingId: string; shortBy: number; at: string }[];
  createdAt: string; // ISO timestamp
  history: { at: string; status: OrderStatus; by: string; note?: string }[];
};

export type BidStatus = 'open' | 'accepted' | 'rejected' | 'withdrawn';
export type Bid = {
  id: string;
  producerId: string;
  price: number; // GBP per unit
  qty: number;
  note?: string;
  createdAt: string;
  status: BidStatus;
  orderId?: string; // set once accepted
};

export type RequestStatus = 'open' | 'filled' | 'closed';

/** A speculative order: a buyer asks for something for a future date, whether or not anyone lists it yet. */
export type DemandRequest = {
  id: string; // e.g. DR-101
  buyerId: string;
  productId: string;
  qty: number;
  deliveryDate: string;
  /** Price per unit the buyer would pay; required under first-to-accept. */
  targetPrice?: number;
  note?: string;
  status: RequestStatus;
  filledQty: number;
  bids: Bid[];
  createdAt: string;
  /** Bumped on every change, so simultaneous bids and acceptances cannot overwrite each other. */
  version: number;
};

/** What a screen receives: bids are filtered by who is asking, and pooled demand is summarised. */
export type RequestView = Omit<DemandRequest, 'version'> & {
  bidCount: number;
  pool?: { totalQty: number; requests: number; buyers: number };
};
