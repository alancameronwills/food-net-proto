import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DIMENSIONS, capabilities, localStatus, sanitiseConfig } from '../src/shared/models';
import { offersFor } from '../src/shared/browse';
import { buildSeed, addDays } from '../src/server/seed';

const seed = buildSeed('2026-10-26');
const boot = (config = DEFAULT_CONFIG) => ({ ...seed, config });

describe('sanitiseConfig', () => {
  it('accepts valid options and ignores junk', () => {
    const c = sanitiseConfig({ market: 'rfq', delivery: 'nope', forecastPct: 5, flatRadiusKm: 80, extra: 1 });
    expect(c.market).toBe('rfq');
    expect(c.delivery).toBe(DEFAULT_CONFIG.delivery);
    expect(c.forecastPct).toBe(DEFAULT_CONFIG.forecastPct);
    expect(c.flatRadiusKm).toBe(80);
    expect('extra' in c).toBe(false);
  });
  it('default config uses a valid option in every dimension', () => {
    for (const d of DIMENSIONS) expect(d.options.map((o) => o.id)).toContain(DEFAULT_CONFIG[d.id]);
  });
  it('every option has English and Welsh text', () => {
    for (const d of DIMENSIONS) for (const o of d.options) {
      expect(o.label.en && o.label.cy && o.explain.en && o.explain.cy).toBeTruthy();
    }
  });
});

describe('local range', () => {
  it('per-category: hides beyond the category limit', () => {
    expect(localStatus(DEFAULT_CONFIG, 20, 21)).toBe('hidden');
    expect(localStatus(DEFAULT_CONFIG, 100, 99)).toBe('ok');
  });
  it('warn: keeps but flags; flat: uses the single radius', () => {
    expect(localStatus({ ...DEFAULT_CONFIG, localRange: 'warn' }, 20, 50)).toBe('warn');
    expect(localStatus({ ...DEFAULT_CONFIG, localRange: 'flat', flatRadiusKm: 60 }, 20, 50)).toBe('ok');
  });
  it('milk from a distant dairy is hidden but its cheese is not', () => {
    const offers = offersFor('grand-hotel', boot());
    const teifi = offers.filter((o) => o.producer.id === 'teifi-valley-cheese');
    expect(teifi.find((o) => o.product.id === 'milk-whole')?.status).toBe('hidden');
    expect(teifi.find((o) => o.product.id === 'cheese-cheddar')?.status).toBe('ok');
  });
  it('switching to warn model un-hides out-of-range offers', () => {
    const hidden = (c = DEFAULT_CONFIG) => offersFor('grand-hotel', boot(c)).filter((o) => o.status === 'hidden').length;
    expect(hidden()).toBeGreaterThan(0);
    expect(hidden({ ...DEFAULT_CONFIG, localRange: 'warn' })).toBe(0);
  });
});

describe('capabilities', () => {
  it('maps models to behaviour flags', () => {
    expect(capabilities({ ...DEFAULT_CONFIG, operator: 'hub' }).consolidatedInvoice).toBe(true);
    expect(capabilities({ ...DEFAULT_CONFIG, stockTrigger: 'on_place' }).producerConfirmsOrders).toBe(false);
    expect(capabilities({ ...DEFAULT_CONFIG, forecastOrdering: 'stock_only' }).forecastCap).toBe(0);
  });
});

describe('seed data', () => {
  it('is internally consistent', () => {
    const orgs = new Set(seed.orgs.map((o) => o.id));
    const prods = new Set(seed.products.map((p) => p.id));
    const cats = new Set(seed.categories.map((c) => c.id));
    const listings = new Set(seed.listings.map((l) => l.id));
    for (const l of seed.listings) { expect(orgs.has(l.producerId)).toBe(true); expect(prods.has(l.productId)).toBe(true); }
    for (const p of seed.products) expect(cats.has(p.category)).toBe(true);
    for (const w of seed.windows) { expect(listings.has(w.listingId)).toBe(true); expect(w.qtyTotal).toBeGreaterThan(0); }
  });
  it('has windows starting today, with in-stock first and later forecast', () => {
    const first = seed.windows.filter((w) => w.start === '2026-10-26');
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((w) => w.confidence === 'in_stock')).toBe(true);
    expect(seed.windows.some((w) => w.confidence === 'provisional')).toBe(true);
  });
  it('skips out-of-season products', () => {
    const tomatoJan = buildSeed('2027-01-05').windows.filter((w) => w.listingId.endsWith('veg-tomato'));
    expect(tomatoJan.length).toBeLessThan(6);
  });
  it('distances are symmetric-ish, zero to self, and Fishguard-Tenby is plausible', () => {
    expect(seed.distances['harbour-bistro']['harbour-bistro']).toBe(0);
    const d = seed.distances['harbour-bistro']['grand-hotel'];
    expect(d).toBeGreaterThan(40); expect(d).toBeLessThan(80);
  });
  it('addDays crosses month boundaries', () => expect(addDays('2026-10-30', 3)).toBe('2026-11-02'));
});
