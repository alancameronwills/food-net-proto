import type { Bilingual } from './types';

/**
 * Switchable operating models. Each dimension has a set of options; the
 * active option per dimension lives in ModelConfig (stored per demo session).
 * UI and server code read capabilities from the config rather than branching
 * on option ids directly where practical (see `capabilities`).
 */
export type ModelOption = { id: string; label: Bilingual; explain: Bilingual };
export type ModelDimension = {
  id: string;
  label: Bilingual;
  options: ModelOption[];
};

const o = (id: string, en: string, cy: string, enX: string, cyX: string): ModelOption => ({
  id,
  label: { en, cy },
  explain: { en: enX, cy: cyX },
});

export const DIMENSIONS = [
  {
    id: 'market',
    label: { en: 'Market structure', cy: 'Strwythur y farchnad' },
    options: [
      o('catalogue', 'Catalogue marketplace', 'Marchnad catalog',
        'Buyers order from what producers have listed.', 'Prynwyr yn archebu o’r hyn y mae cynhyrchwyr wedi’i restru.'),
      o('rfq', 'Demand-led (RFQ)', 'Wedi’i arwain gan alw (RFQ)',
        'Buyers post what they need; producers bid to supply it.', 'Prynwyr yn postio’r hyn sydd ei angen; cynhyrchwyr yn cynnig.'),
      o('forward', 'Forward commitment', 'Ymrwymiad ymlaen llaw',
        'Buyers commit to recurring volumes that producers plan around.', 'Prynwyr yn ymrwymo i symiau rheolaidd i gynhyrchwyr gynllunio ar eu cyfer.'),
    ],
  },
  {
    id: 'operator',
    label: { en: 'Operator role', cy: 'Rôl y gweithredwr' },
    options: [
      o('platform', 'Pure platform', 'Platfform yn unig',
        'Each producer sells and invoices separately.', 'Pob cynhyrchydd yn gwerthu ac yn anfonebu ar wahân.'),
      o('hub', 'Food hub', 'Canolfan fwyd',
        'The network consolidates orders: one invoice, one delivery.', 'Mae’r rhwydwaith yn cyfuno archebion: un anfoneb, un danfoniad.'),
    ],
  },
  {
    id: 'delivery',
    label: { en: 'Delivery', cy: 'Dosbarthu' },
    options: [
      o('producer', 'Producer delivers', 'Cynhyrchydd yn dosbarthu',
        'Each producer delivers its own orders.', 'Pob cynhyrchydd yn dosbarthu ei archebion ei hun.'),
      o('area_days', 'Area delivery days', 'Diwrnodau dosbarthu ardal',
        'Producers publish route days; buyers pick a slot.', 'Cynhyrchwyr yn cyhoeddi diwrnodau llwybr; prynwyr yn dewis slot.'),
      o('hub_courier', 'Hub courier', 'Negesydd y ganolfan',
        'A shared courier collects and delivers consolidated runs.', 'Negesydd a rennir yn casglu ac yn dosbarthu rhediadau cyfunol.'),
    ],
  },
  {
    id: 'stockTrigger',
    label: { en: 'Stock reduction', cy: 'Lleihau stoc' },
    options: [
      o('on_confirm', 'On confirmation', 'Wrth gadarnhau',
        'Advertised stock drops when the producer confirms.', 'Mae’r stoc yn gostwng pan fydd y cynhyrchydd yn cadarnhau.'),
      o('soft_hold', 'Soft hold, then firm', 'Daliad meddal, yna cadarn',
        'Stock is held when ordered, firmed on confirmation.', 'Dal stoc wrth archebu, cadarnhau wedyn.'),
      o('on_place', 'On placement', 'Wrth osod archeb',
        'Orders are auto-accepted and stock drops immediately.', 'Archebion yn cael eu derbyn yn awtomatig a’r stoc yn gostwng ar unwaith.'),
    ],
  },
  {
    id: 'forecastOrdering',
    label: { en: 'Ordering forecast stock', cy: 'Archebu stoc a ragwelir' },
    options: [
      o('pct_limit', 'Up to a % of forecast', 'Hyd at ganran o’r rhagolwg',
        'Buyers may order up to a set share of forecast quantity.', 'Gall prynwyr archebu hyd at gyfran o’r maint a ragwelir.'),
      o('stock_only', 'In stock only', 'Mewn stoc yn unig',
        'Only confirmed in-stock quantities can be ordered.', 'Dim ond meintiau mewn stoc sy’n cael eu harchebu.'),
      o('full_forecast', 'Fully orderable', 'Gellir archebu’r cyfan',
        'All forecast can be ordered; shortfalls are substituted.', 'Gellir archebu’r holl ragolwg; amnewid wrth brinder.'),
    ],
  },
  {
    id: 'speculative',
    label: { en: 'Speculative orders', cy: 'Archebion damcaniaethol' },
    options: [
      o('open_rfq', 'Open RFQ', 'RFQ agored',
        'Any producer can bid; the buyer chooses.', 'Gall unrhyw gynhyrchydd gynnig; y prynwr sy’n dewis.'),
      o('first_accept', 'First to accept', 'Cyntaf i dderbyn',
        'Buyer sets a price; the first producer to accept wins.', 'Prynwr yn gosod pris; y cynhyrchydd cyntaf i dderbyn sy’n ennill.'),
      o('pooled', 'Pooled demand', 'Galw cyfun',
        'Similar requests from several buyers are merged.', 'Cyfuno ceisiadau tebyg gan sawl prynwr.'),
    ],
  },
  {
    id: 'pricing',
    label: { en: 'Pricing', cy: 'Prisio' },
    options: [
      o('fixed', 'Producer fixed price', 'Pris sefydlog',
        'Producers set one price per listing.', 'Cynhyrchwyr yn gosod un pris fesul rhestriad.'),
      o('tiers', 'Volume tiers', 'Haenau cyfaint',
        'Bigger orders earn a lower unit price.', 'Archebion mwy yn cael pris uned is.'),
      o('bid', 'Bid price', 'Pris cynnig',
        'Price is set by bids on demand requests.', 'Pris yn cael ei osod gan gynigion ar geisiadau galw.'),
    ],
  },
  {
    id: 'localRange',
    label: { en: 'Local range', cy: 'Ystod leol' },
    options: [
      o('per_category', 'Per-product distance', 'Pellter fesul cynnyrch',
        'Milk 20 km … cheese 100 km; out-of-range items are hidden.', 'Llaeth 20 km … caws 100 km; eitemau y tu hwnt i’r ystod wedi’u cuddio.'),
      o('warn', 'Warn only', 'Rhybuddio yn unig',
        'Out-of-range items are shown greyed with a warning.', 'Eitemau y tu hwnt i’r ystod wedi’u llwydo gyda rhybudd.'),
      o('flat', 'Flat radius', 'Radiws sefydlog',
        'One distance for everything, set by the operator.', 'Un pellter ar gyfer popeth, wedi’i osod gan y gweithredwr.'),
    ],
  },
  {
    id: 'trust',
    label: { en: 'Trust display', cy: 'Dangos ymddiriedaeth' },
    options: [
      o('score', 'Reliability score', 'Sgôr dibynadwyedd',
        'Producers show a delivery reliability score.', 'Cynhyrchwyr yn dangos sgôr dibynadwyedd.'),
      o('hidden', 'Hidden', 'Cudd', 'No trust indicators shown.', 'Dim dangosyddion ymddiriedaeth.'),
      o('badges', 'Verified badges', 'Bathodynnau wedi’u gwirio',
        'Only “verified member” badges are shown.', 'Dim ond bathodynnau “aelod wedi’i wirio”.'),
    ],
  },
] as const satisfies readonly ModelDimension[];

export type DimensionId = (typeof DIMENSIONS)[number]['id'];

export type ModelConfig = {
  [D in DimensionId]: string;
} & {
  /** Max share of forecast quantity orderable under `pct_limit` (0-1). */
  forecastPct: number;
  /** Radius in km used by the `flat` local range option. */
  flatRadiusKm: number;
};

export const DEFAULT_CONFIG: ModelConfig = {
  market: 'catalogue',
  operator: 'platform',
  delivery: 'producer',
  stockTrigger: 'on_confirm',
  forecastOrdering: 'pct_limit',
  speculative: 'open_rfq',
  pricing: 'fixed',
  localRange: 'per_category',
  trust: 'score',
  forecastPct: 0.7,
  flatRadiusKm: 50,
};

/** Validate an untrusted partial config against the dimension table. */
export function sanitiseConfig(input: Record<string, unknown>, base: ModelConfig = DEFAULT_CONFIG): ModelConfig {
  const out: ModelConfig = { ...base };
  for (const d of DIMENSIONS) {
    const v = input[d.id];
    if (typeof v === 'string' && d.options.some((opt) => opt.id === v)) {
      (out as Record<string, unknown>)[d.id] = v;
    }
  }
  if (typeof input.forecastPct === 'number' && input.forecastPct >= 0 && input.forecastPct <= 1) {
    out.forecastPct = input.forecastPct;
  }
  if (typeof input.flatRadiusKm === 'number' && input.flatRadiusKm >= 1 && input.flatRadiusKm <= 500) {
    out.flatRadiusKm = input.flatRadiusKm;
  }
  return out;
}

/** What the UI / server rules should do under a config, so callers don't branch on option ids. */
export function capabilities(c: ModelConfig) {
  return {
    showDemandBoard: c.market === 'rfq' || c.market === 'catalogue',
    showStandingOrders: c.market === 'forward',
    consolidatedInvoice: c.operator === 'hub',
    deliveryRequiresSlot: c.delivery === 'area_days',
    consolidatedDelivery: c.delivery === 'hub_courier' || c.operator === 'hub',
    producerConfirmsOrders: c.stockTrigger !== 'on_place',
    softHoldOnPlace: c.stockTrigger === 'soft_hold',
    forecastOrderable: c.forecastOrdering !== 'stock_only',
    forecastCap: c.forecastOrdering === 'pct_limit' ? c.forecastPct : c.forecastOrdering === 'full_forecast' ? 1 : 0,
    hideOutOfRange: c.localRange !== 'warn',
    showReliability: c.trust === 'score',
    showBadges: c.trust === 'badges',
    volumeTiers: c.pricing === 'tiers',
    pooledDemand: c.speculative === 'pooled',
  };
}

/** Max drive distance for a category under the active local-range model. */
export function rangeKm(c: ModelConfig, categoryMaxKm: number): number {
  return c.localRange === 'flat' ? c.flatRadiusKm : categoryMaxKm;
}

/** Is the item in range, and should it be hidden / warned? */
export function localStatus(c: ModelConfig, categoryMaxKm: number, driveKm: number): 'ok' | 'warn' | 'hidden' {
  if (driveKm <= rangeKm(c, categoryMaxKm)) return 'ok';
  return c.localRange === 'warn' ? 'warn' : 'hidden';
}
