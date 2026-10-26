import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Bilingual } from '../shared/types';

// Welsh strings are machine-translated drafts, pending human review.
const en = {
  title: 'Bwyd Lleol Bro Teifi',
  tagline: 'Teifi Valley local food network',
  chooseRole: 'Who are you playing today?',
  chooseHint: 'Pick an organisation to see the network through their eyes. Share a link so others can join as another role.',
  buyers: 'Buyers', producers: 'Producers', operatorRole: 'Network operator',
  session: 'Demo session', switchPersona: 'Switch role', model: 'Model', modelLab: 'Model Lab',
  playingAs: 'Playing as', copyLink: 'Copy link for this role', copied: 'Copied!',
  localSuppliers: 'Local suppliers near you', localSub: 'Distances are approximate drive distances from your site.',
  product: 'Product', producer: 'Producer', distance: 'Drive distance', range: 'Local limit', price: 'Price', status: 'Status',
  inRange: 'Local', outOfRange: 'Too far', warnFar: 'Beyond local range', hiddenCount: '{{n}} offers hidden as out of local range.',
  yourListings: 'Your listings', stockWindows: 'Supply windows', week: 'Week of', qty: 'Quantity', reserved: 'Reserved',
  inStock: 'In stock', forecast: 'Forecast', provisional: 'Provisional',
  modelLabIntro: 'Switch the operating model live. Every screen in this session updates within a few seconds.',
  forecastPct: 'Share of forecast orderable', flatRadius: 'Flat radius (km)',
  resetSession: 'Reset demo data', resetConfirm: 'Reset this session to the starting data?', resetDone: 'Session reset.',
  shareLinks: 'Role links for this session', language: 'Cymraeg', loading: 'Loading…', error: 'Something went wrong.',
  operatorOnly: 'Only the network operator can change models.', comingSoon: 'Coming in a later phase.',
  perUnit: 'per {{unit}}', km: '{{n}} km',
  tabStock: 'Stock & forecast', tabListings: 'My listings',
  weeks: 'Weeks', thisWeek: 'This week', addWeek: '+ Add', save: 'Save', saved: 'Saved', cancel: 'Cancel', remove: 'Remove', edit: 'Edit',
  orderableNow: 'Buyers can order', freeStock: 'free', reservedQty: '{{n}} reserved', outOfSeason: 'Out of season',
  addFour: 'Add next 4 weeks', addFourHelp: 'Fill in any missing weeks from this week:', quantity: 'Quantity', confidence: 'Confidence',
  conf_in_stock: 'In stock', conf_forecast: 'Forecast', conf_provisional: 'Provisional',
  confHelp_in_stock: 'Ready to supply; counts fully.', confHelp_forecast: 'Expected; buyers can order a share of it (depends on the model).',
  confHelp_provisional: 'A plan only; buyers cannot order yet but can see it.',
  addListing: 'Add a product to sell', chooseProduct: 'Choose a product…', pricePerUnitLabel: 'Price per unit (£)', minOrderLabel: 'Minimum order',
  volumeTiers: 'Volume prices', addTier: '+ Add a price break', tierFrom: 'From quantity', tierPrice: 'Price (£)',
  tiersOnlyNote: 'Volume prices are used in the “Volume tiers” pricing model.',
  confirmRemoveListing: 'Remove this product and all its supply weeks?', confirmRemoveWeek: 'Remove this week?',
  noListings: 'You are not selling anything yet. Add a product to get started.',
  summaryListings: 'Products', summaryNext4: 'Products buyers can order in the next 4 weeks', summaryReserved: 'Weeks with orders from buyers',
  sold: 'Order', soldOut: 'Sold out', notEditable: 'Reserved stock; you can raise but not lower below {{n}}.',
  units: { litre: 'litre', kg: 'kg', dozen: 'dozen', loaf: 'loaf', each: 'each', crate: 'crate' },
};
const cy: typeof en = {
  title: 'Bwyd Lleol Bro Teifi',
  tagline: 'Rhwydwaith bwyd lleol Bro Teifi',
  chooseRole: 'Pwy ydych chi’n ei chwarae heddiw?',
  chooseHint: 'Dewiswch sefydliad i weld y rhwydwaith drwy ei lygaid. Rhannwch ddolen i eraill ymuno mewn rôl arall.',
  buyers: 'Prynwyr', producers: 'Cynhyrchwyr', operatorRole: 'Gweithredwr y rhwydwaith',
  session: 'Sesiwn arddangos', switchPersona: 'Newid rôl', model: 'Model', modelLab: 'Labordy Modelau',
  playingAs: 'Chwarae fel', copyLink: 'Copïo dolen ar gyfer y rôl hon', copied: 'Wedi copïo!',
  localSuppliers: 'Cyflenwyr lleol yn agos atoch', localSub: 'Mae’r pellteroedd yn bellteroedd gyrru bras o’ch safle.',
  product: 'Cynnyrch', producer: 'Cynhyrchydd', distance: 'Pellter gyrru', range: 'Terfyn lleol', price: 'Pris', status: 'Statws',
  inRange: 'Lleol', outOfRange: 'Rhy bell', warnFar: 'Y tu hwnt i’r ystod leol', hiddenCount: 'Mae {{n}} cynnig wedi’u cuddio am eu bod y tu hwnt i’r ystod leol.',
  yourListings: 'Eich rhestriadau', stockWindows: 'Cyfnodau cyflenwi', week: 'Wythnos yn dechrau', qty: 'Maint', reserved: 'Wedi’i neilltuo',
  inStock: 'Mewn stoc', forecast: 'Rhagolwg', provisional: 'Dros dro',
  modelLabIntro: 'Newidiwch y model gweithredu’n fyw. Mae pob sgrin yn y sesiwn hon yn diweddaru o fewn ychydig eiliadau.',
  forecastPct: 'Cyfran o’r rhagolwg y gellir ei harchebu', flatRadius: 'Radiws sefydlog (km)',
  resetSession: 'Ailosod data’r arddangosiad', resetConfirm: 'Ailosod y sesiwn i’r data cychwynnol?', resetDone: 'Sesiwn wedi’i hailosod.',
  shareLinks: 'Dolenni rôl ar gyfer y sesiwn hon', language: 'English', loading: 'Wrthi’n llwytho…', error: 'Aeth rhywbeth o’i le.',
  operatorOnly: 'Dim ond gweithredwr y rhwydwaith all newid modelau.', comingSoon: 'Yn dod mewn cam diweddarach.',
  perUnit: 'y {{unit}}', km: '{{n}} km',
  tabStock: 'Stoc a rhagolwg', tabListings: 'Fy rhestriadau',
  weeks: 'Wythnosau', thisWeek: 'Yr wythnos hon', addWeek: '+ Ychwanegu', save: 'Cadw', saved: 'Wedi’i gadw', cancel: 'Canslo', remove: 'Dileu', edit: 'Golygu',
  orderableNow: 'Gall prynwyr archebu', freeStock: 'rhydd', reservedQty: '{{n}} wedi’u neilltuo', outOfSeason: 'Allan o dymor',
  addFour: 'Ychwanegu’r 4 wythnos nesaf', addFourHelp: 'Llenwi unrhyw wythnosau coll o’r wythnos hon:', quantity: 'Maint', confidence: 'Hyder',
  conf_in_stock: 'Mewn stoc', conf_forecast: 'Rhagolwg', conf_provisional: 'Dros dro',
  confHelp_in_stock: 'Yn barod i’w gyflenwi; yn cyfrif yn llawn.', confHelp_forecast: 'Disgwyliedig; gall prynwyr archebu cyfran ohono (yn dibynnu ar y model).',
  confHelp_provisional: 'Cynllun yn unig; ni all prynwyr archebu eto ond gallant ei weld.',
  addListing: 'Ychwanegu cynnyrch i’w werthu', chooseProduct: 'Dewiswch gynnyrch…', pricePerUnitLabel: 'Pris yr uned (£)', minOrderLabel: 'Archeb leiaf',
  volumeTiers: 'Prisiau cyfaint', addTier: '+ Ychwanegu toriad pris', tierFrom: 'O’r maint', tierPrice: 'Pris (£)',
  tiersOnlyNote: 'Defnyddir prisiau cyfaint yn y model prisio “Haenau cyfaint”.',
  confirmRemoveListing: 'Dileu’r cynnyrch hwn a’i holl wythnosau cyflenwi?', confirmRemoveWeek: 'Dileu’r wythnos hon?',
  noListings: 'Dydych chi ddim yn gwerthu dim eto. Ychwanegwch gynnyrch i ddechrau.',
  summaryListings: 'Cynhyrchion', summaryNext4: 'Cynhyrchion y gall prynwyr eu harchebu yn y 4 wythnos nesaf', summaryReserved: 'Wythnosau gydag archebion gan brynwyr',
  sold: 'Archeb', soldOut: 'Wedi gwerthu allan', notEditable: 'Stoc wedi’i neilltuo; gallwch ei godi ond nid ei ostwng o dan {{n}}.',
  units: { litre: 'litr', kg: 'kg', dozen: 'dwsin', loaf: 'torth', each: 'yr un', crate: 'cawell' },
};

const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, cy: { translation: cy } },
  lng: saved === 'cy' ? 'cy' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLang(l: 'en' | 'cy') {
  localStorage.setItem('lang', l);
  document.documentElement.lang = l;
  void i18n.changeLanguage(l);
}

/** Pick the current-language string from a bilingual pair. */
export const loc = (b: Bilingual): string => (i18n.language === 'cy' ? b.cy : b.en);
export default i18n;
