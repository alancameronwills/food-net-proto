import { parseOrganisations } from '../src/server/organisations';
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
  it('distances are zero to self, symmetric, and plausible for one county', () => {
    const ids = seed.orgs.map((o) => o.id);
    for (const a of ids) {
      expect(seed.distances[a][a]).toBe(0);
      for (const b of ids.filter((x) => x !== a)) {
        expect(Math.abs(seed.distances[a][b] - seed.distances[b][a])).toBeLessThanOrEqual(1);
        expect(seed.distances[a][b]).toBeLessThan(150);
      }
    }
  });
  it('addDays crosses month boundaries', () => expect(addDays('2026-10-30', 3)).toBe('2026-11-02'));
});

describe('organisations.json validation', () => {
  const products = new Set(['milk-whole', 'veg-leek']);
  const buyer = { id: 'b1', role: 'buyer', name: 'B', kind: 'hotel', town: 'T', lat: 51.8, lon: -4.9, blurb: { en: 'x' } };
  const producer = { id: 'p1', role: 'producer', name: 'P', kind: 'farm', town: 'T', lat: 51.9, lon: -4.9, blurb: { en: 'x' },
    offers: [{ product: 'milk-whole', price: 1, minOrder: 2 }] };
  const op = { id: 'op', role: 'operator', name: 'Op', kind: 'network', town: 'T', lat: 51.8, lon: -4.9, blurb: { en: 'x' } };
  const ok = [buyer, producer, op];

  it('accepts a valid file; Welsh blurb falls back to English', () => {
    const r = parseOrganisations(ok, products);
    expect(r.orgs).toHaveLength(3);
    expect(r.orgs[0].blurb.cy).toBe('x');
    expect(r.listings[0]).toMatchObject({ id: 'p1:milk-whole', pricePerUnit: 1, minOrder: 2 });
  });
  it('reports every problem with the entry that caused it', () => {
    const bad = [{ ...buyer, id: 'Bad Id' }, { ...producer, offers: [{ product: 'nope', price: 1, minOrder: 1 }] }, { ...producer }];
    expect(() => parseOrganisations(bad, products)).toThrowError(/entry 1.*"id"[\s\S]*unknown product "nope"[\s\S]*duplicate "id"[\s\S]*exactly one operator/);
  });
  it('rejects coordinates outside the area, a producer with no offers, and offers on a buyer', () => {
    expect(() => parseOrganisations([{ ...buyer, lat: 10 }, producer, op], products)).toThrowError(/"lat"/);
    expect(() => parseOrganisations([buyer, { ...producer, offers: [] }, op], products)).toThrowError(/at least one entry in "offers"/);
    expect(() => parseOrganisations([{ ...buyer, offers: [] }, producer, op], products)).toThrowError(/only producers/);
  });
  it('requires a buyer, a producer and one operator', () => {
    expect(() => parseOrganisations([producer, op], products)).toThrowError(/at least one buyer/);
    expect(() => parseOrganisations([buyer, producer, op, { ...op, id: 'op2' }], products)).toThrowError(/exactly one operator \(found 2\)/);
  });
  it('the shipped data file is valid', () => {
    expect(seed.orgs.length).toBeGreaterThanOrEqual(3);
  });
});
