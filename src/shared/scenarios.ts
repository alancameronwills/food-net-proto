import type { Bilingual } from './types';

/**
 * Guided demonstrations. Starting one resets the session, applies the scenario's model settings and any
 * pre-arranged situation (see src/server/scenarios.ts), then shows everyone a short checklist.
 * Steps tick themselves when the matching thing happens (read from the network activity feed), or by hand.
 */
export type ScenarioEvent = { type: string };
export type ScenarioStep = {
  /** Organisation id to play, or 'operator'. */
  who: string;
  text: Bilingual;
  /** Completed automatically when the session's activity (since the scenario started) satisfies this. Omit for a manual tick. */
  done?: (events: ScenarioEvent[]) => boolean;
};
export type Scenario = {
  id: string;
  title: Bilingual;
  summary: Bilingual;
  /** Model settings applied at the start (anything not listed returns to its default). */
  config: Record<string, unknown>;
  steps: ScenarioStep[];
  /** True if the scenario is about demand requests: starting it switches them on, even if the operator had them off. */
  usesDemand?: boolean;
  /** False for scenarios that depend on something not built yet; they are listed but cannot be started. */
  available: boolean;
  unavailableReason?: Bilingual;
};

const count = (type: string, n = 1) => (events: ScenarioEvent[]) => events.filter((e) => e.type === type).length >= n;
const b = (en: string, cy: string): Bilingual => ({ en, cy });

export const SCENARIOS: Scenario[] = [
  {
    id: 'plan-menu',
    title: b('Plan next week’s menu', 'Cynllunio bwydlen yr wythnos nesaf'),
    summary: b('A chef looks ahead, sees what is in stock and what is only forecast, and orders for next week.', 'Mae cogydd yn edrych ymlaen, yn gweld beth sydd mewn stoc a beth sydd wedi’i ragweld yn unig, ac yn archebu ar gyfer yr wythnos nesaf.'),
    config: {},
    available: true,
    steps: [
      { who: 'corner-deli', text: b('Open the Menu planner. Green is in stock, amber is forecast, grey is only planned.', 'Agorwch y Cynllunydd bwydlen. Gwyrdd yw mewn stoc, ambr yw rhagolwg, llwyd yw wedi’i gynllunio yn unig.') },
      { who: 'corner-deli', text: b('Click an amber (forecast) cell a couple of weeks out. It jumps to Browse for that week.', 'Cliciwch gell ambr (rhagolwg) ychydig wythnosau ymlaen. Mae’n neidio i Pori ar gyfer yr wythnos honno.') },
      { who: 'corner-deli', text: b('Add two items to the basket and place the order.', 'Ychwanegwch ddwy eitem at y fasged a gosodwch yr archeb.'), done: count('order_placed') },
    ],
  },
  {
    id: 'stock-down',
    title: b('Watch the stock go down', 'Gwylio’r stoc yn gostwng'),
    summary: b('An order is placed and confirmed; the producer’s available stock drops on their own screen.', 'Gosodir archeb a’i chadarnhau; mae stoc ar gael y cynhyrchydd yn gostwng ar ei sgrin ei hun.'),
    config: {},
    available: true,
    steps: [
      { who: 'dyfed-dairy', text: b('Open Stock & forecast and note how much whole milk can be ordered this week.', 'Agorwch Stoc a rhagolwg a nodwch faint o laeth cyflawn y gellir ei archebu’r wythnos hon.') },
      { who: 'corner-deli', text: b('Order 20 litres or more of whole milk from Dyfed Dairy.', 'Archebwch 20 litr neu fwy o laeth cyflawn gan Dyfed Dairy.'), done: count('order_placed') },
      { who: 'dyfed-dairy', text: b('In Orders, press Confirm.', 'Yn Archebion, pwyswch Cadarnhau.'), done: count('order_confirmed') },
      { who: 'dyfed-dairy', text: b('Back in Stock & forecast, that week now shows what is reserved, and “Buyers can order” has dropped.', 'Yn ôl yn Stoc a rhagolwg, mae’r wythnos honno bellach yn dangos beth sydd wedi’i neilltuo, ac mae “Gall prynwyr archebu” wedi gostwng.') },
    ],
  },
  {
    id: 'forecast-cut',
    title: b('The forecast is cut', 'Torri’r rhagolwg'),
    summary: b('Two buyers have ordered from a forecast week. The producer reduces it, and the buyers are warned and offered alternatives.', 'Mae dau brynwr wedi archebu o wythnos ragolwg. Mae’r cynhyrchydd yn ei lleihau, a rhybuddir y prynwyr a chynigir dewisiadau eraill iddynt.'),
    config: { stockTrigger: 'on_place', forecastOrdering: 'full_forecast' },
    available: true,
    steps: [
      { who: 'dyfed-dairy', text: b('Orders are already in for whole milk two weeks ahead. In Stock & forecast, change that week from Forecast to Provisional.', 'Mae archebion eisoes i mewn am laeth cyflawn ymhen pythefnos. Yn Stoc a rhagolwg, newidiwch yr wythnos honno o Ragolwg i Dros dro.'), done: count('supply_cut') },
      { who: 'castle-caterers', text: b('In My orders, read the warning. Add an alternative producer to the basket, or keep the order.', 'Yn Fy archebion, darllenwch y rhybudd. Ychwanegwch gynhyrchydd amgen at y fasged, neu cadwch yr archeb.') },
      { who: 'dyfed-dairy', text: b('Change the week back to Forecast: the warnings clear themselves.', 'Newidiwch yr wythnos yn ôl i Ragolwg: mae’r rhybuddion yn clirio eu hunain.') },
    ],
  },
  {
    id: 'speculative',
    title: b('Ask for something not yet available', 'Gofyn am rywbeth nad yw ar gael eto'),
    summary: b('A buyer asks for heritage tomatoes in three weeks. Two producers bid; the buyer chooses.', 'Mae prynwr yn gofyn am domatos treftadaeth ymhen tair wythnos. Mae dau gynhyrchydd yn cynnig; y prynwr sy’n dewis.'),
    config: { speculative: 'open_rfq' },
    usesDemand: true,
    available: true,
    steps: [
      { who: 'corner-deli', text: b('In Ask for something, request 40 kg of Heritage tomatoes in three weeks, with a price you would pay.', 'Yn Gofyn am rywbeth, gofynnwch am 40 kg o domatos treftadaeth ymhen tair wythnos, gyda phris y byddech yn ei dalu.'), done: count('request_new') },
      { who: 'brynberian-garden', text: b('On the Demand board, bid a price and quantity.', 'Ar y Bwrdd galw, cynigiwch bris a maint.'), done: count('bid_placed') },
      { who: 'preseli-hill-farm', text: b('This farm has never sold tomatoes. Bid anyway.', 'Nid yw’r fferm hon erioed wedi gwerthu tomatos. Cynigiwch beth bynnag.'), done: count('bid_placed', 2) },
      { who: 'corner-deli', text: b('Compare the bids and accept one.', 'Cymharwch y cynigion a derbyniwch un.'), done: count('bid_accepted') },
    ],
  },
  {
    id: 'multi-producer',
    title: b('A basket from several producers', 'Basged gan sawl cynhyrchydd'),
    summary: b('One checkout becomes one order per producer; under the food hub it is one invoice and one delivery.', 'Mae un ddesg dalu yn dod yn un archeb i bob cynhyrchydd; o dan y ganolfan fwyd mae’n un anfoneb ac un danfoniad.'),
    config: {},
    available: true,
    steps: [
      { who: 'grand-hotel', text: b('Add free-range eggs, sourdough (Nevern Bakery) and fish (Dinas Catch) to the basket. Note “separate invoices”.', 'Ychwanegwch wyau buarth, surdoes (Nevern Bakery) a physgod (Dinas Catch) at y fasged. Nodwch “anfonebau ar wahân”.') },
      { who: 'grand-hotel', text: b('Place the order: three orders are created, one per producer.', 'Gosodwch yr archeb: crëir tair archeb, un i bob cynhyrchydd.'), done: count('order_placed', 3) },
      { who: 'operator', text: b('In Model Lab, switch Operator role to Food hub. Look at a basket again: one invoice, one delivery.', 'Yn Labordy Modelau, newidiwch Rôl y gweithredwr i Ganolfan fwyd. Edrychwch ar fasged eto: un anfoneb, un danfoniad.') },
    ],
  },
  {
    id: 'short-delivery',
    title: b('A short delivery', 'Danfoniad byr'),
    summary: b('A producer delivers less than was ordered. The buyer pays for what arrived and the producer’s reliability score dips.', 'Mae cynhyrchydd yn dosbarthu llai nag a archebwyd. Mae’r prynwr yn talu am yr hyn a gyrhaeddodd ac mae sgôr dibynadwyedd y cynhyrchydd yn gostwng.'),
    config: { stockTrigger: 'on_place' },
    available: true,
    steps: [
      { who: 'dyfed-dairy', text: b('An order is waiting. In Orders, press Mark delivered and enter fewer litres than ordered.', 'Mae archeb yn aros. Yn Archebion, pwyswch Nodi wedi’i ddosbarthu a rhowch lai o litrau nag a archebwyd.'), done: count('order_short') },
      { who: 'corner-deli', text: b('In My orders, see the crossed-out quantity and the lower total.', 'Yn Fy archebion, gwelwch y maint wedi’i groesi allan a’r cyfanswm is.') },
      { who: 'corner-deli', text: b('In Browse, find Dyfed Dairy: its reliability score has moved.', 'Yn Pori, dewch o hyd i Dyfed Dairy: mae ei sgôr dibynadwyedd wedi symud.') },
    ],
  },
  {
    id: 'delivery-models',
    title: b('Who brings it?', 'Pwy sy’n ei ddod?'),
    summary: b('Compare producers delivering themselves, producer rounds by area, and a shared hub courier.', 'Cymharwch gynhyrchwyr yn dosbarthu eu hunain, rowndiau cynhyrchwyr yn ôl ardal, a negesydd canolfan a rennir.'),
    config: { delivery: 'producer' },
    available: true,
    steps: [
      { who: 'grand-hotel', text: b('In Browse, note the strip of delivery days and how many things can be ordered each day.', 'Yn Pori, nodwch y stribed o ddiwrnodau dosbarthu a faint o bethau y gellir eu harchebu bob diwrnod.') },
      { who: 'operator', text: b('In Model Lab, set Delivery to Area delivery days.', 'Yn Labordy Modelau, gosodwch Dosbarthu i Ddiwrnodau dosbarthu ardal.') },
      { who: 'grand-hotel', text: b('The strip changes: producers now only deliver on their rounds to your area. Open a product to see its days.', 'Mae’r stribed yn newid: dim ond ar eu rowndiau i’ch ardal y mae cynhyrchwyr yn dosbarthu bellach. Agorwch gynnyrch i weld ei ddiwrnodau.') },
      { who: 'operator', text: b('Now set Delivery to Hub courier and choose the hub days. Place two orders as a buyer, then open Delivery runs.', 'Nawr gosodwch Dosbarthu i Negesydd y ganolfan a dewiswch ddiwrnodau’r ganolfan. Gosodwch ddwy archeb fel prynwr, yna agorwch Rowndiau dosbarthu.') },
    ],
  },
  {
    id: 'standing-order',
    title: b('A standing weekly order', 'Archeb wythnosol sefydlog'),
    summary: b('A buyer commits to the same bread every week, and the baker plans around it.', 'Mae prynwr yn ymrwymo i’r un bara bob wythnos, ac mae’r pobydd yn cynllunio o’i gwmpas.'),
    config: { market: 'forward' },
    available: false,
    unavailableReason: b('Standing orders (the forward-commitment model) are not built yet.', 'Nid yw archebion sefydlog (y model ymrwymiad ymlaen llaw) wedi’u hadeiladu eto.'),
    steps: [],
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/** Which steps are finished, given the events since the scenario began and any steps ticked by hand. */
export function stepStates(scenario: Scenario, events: ScenarioEvent[], manual: Set<number>): boolean[] {
  return scenario.steps.map((s, i) => (s.done ? s.done(events) : manual.has(i)));
}
