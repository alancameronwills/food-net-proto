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
