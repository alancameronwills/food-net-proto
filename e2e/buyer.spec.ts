import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { nextWeekday } from '../src/shared/orders';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-b${n++}-${Math.random().toString(36).slice(2, 6)}`;
const MILK = 'dyfed-dairy:milk-whole';
const SOON_THURSDAY = nextWeekday(addDays(todayIso(), 3), [4]);
// "Thu 5 Nov", as the screens write it (Node puts a comma after the weekday)
const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
const DELIVERY = nextWeekday(addDays(todayIso(), 3), [4]); // the buyer's default delivery day: next Thursday at least 3 days away
const WEEK = mondayOf(DELIVERY);

async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}

/** Make everyone "local" to everyone, so the range rules do not interfere with an ordering test. */
async function setModel(request: APIRequestContext, session: string, config: Record<string, unknown> = {}) {
  const r = await request.put('/api/config', {
    headers: { 'x-session': session, 'x-persona': 'operator' }, data: { localRange: 'flat', flatRadiusKm: 200, ...config },
  });
  expect(r.ok()).toBe(true);
}

const buyerUrl = (s: string, as = 'corner-deli') => `/home?s=${s}&as=${as}`;
const producerUrl = (s: string, as = 'dyfed-dairy') => `/home?s=${s}&as=${as}`;

async function addMilk(page: import('@playwright/test').Page, qty: number) {
  const offer = page.getByTestId(`offer-${MILK}`);
  await offer.getByLabel(/^Quantity/).fill(String(qty));
  await offer.getByRole('button', { name: 'Add' }).click();
}

test.describe('buyer: browsing and the basket', () => {
  test('shows the whole catalogue, with a stock flag, delivery day and shelf life for the day you need it', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await expect(page.getByLabel('Needed on')).toHaveValue(SOON_THURSDAY);
    await expect(page.getByTestId('delivery-long')).toContainText('Thursday');
    const offer = page.getByTestId(`offer-${MILK}`);
    await expect(offer).toContainText('Whole milk');
    await expect(offer).toContainText('Dyfed Dairy');
    await expect(offer).toContainText('£0.95 per litre');
    await expect(offer.getByTestId('stock-flag')).toContainText(/✓ (In stock|Forecast)/);
    await expect(offer.getByTestId('delivered-on')).toContainText('Delivered Thu'); // milk is delivered that very day
    await expect(offer.getByTestId('shelf-life')).toHaveText('Good for 2 days after delivery');
    await expect(page.getByTestId('offer-dyfed-dairy:cheese-cheddar').getByTestId('shelf-life')).toHaveText('Good for 2 months after delivery');
  });

  test('the whole catalogue stays visible whatever the date, and the filter is optional', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    const cards = page.locator('[data-testid^="offer-"]');
    await expect(cards.first()).toBeVisible();
    const everything = await cards.count();
    expect(everything).toBeGreaterThan(20);
    await page.getByLabel('Needed on').fill(addDays(todayIso(), 120)); // far beyond any planned supply
    await expect(cards).toHaveCount(everything); // nothing disappears
    await expect(page.locator('[data-testid^="offer-"][data-available="true"]')).toHaveCount(0);
    await page.getByLabel('Only what I can order').check();
    await expect(page.getByText('Nothing matches')).toBeVisible();
    await page.getByLabel('Only what I can order').uncheck();
    await expect(cards).toHaveCount(everything);
  });

  test('items that cannot be had that day show the nearest days that work, and jump to them', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    const far = addDays(todayIso(), 80); // well past the last planned week
    await page.getByLabel('Needed on').fill(far);
    const milk = page.getByTestId(`offer-${MILK}`);
    await expect(milk).toHaveAttribute('data-available', 'false');
    await expect(milk.getByTestId('why-not')).toContainText('Not available for');
    await expect(milk.getByTestId('nearest-later')).toHaveCount(0); // nothing is planned after the last week
    await milk.getByTestId('nearest-earlier').click(); // the last day milk delivered then would still be good
    await expect(milk).toHaveAttribute('data-available', 'true');
    await expect(milk.getByTestId('stock-flag')).toBeVisible();
    const chosen = await page.getByLabel('Needed on').inputValue();
    expect(chosen < far).toBe(true);
  });

  test('a longer shelf life, set by the producer, makes more days work', async ({ browser, request }) => {
    const s = newSession();
    // Only Tuesdays: milk (good for 2 days) is fine for Tue-Thu, but not for a Friday
    await setModel(request, s, { delivery: 'hub_courier', hubDays: [2] });
    const tuesday = nextWeekday(addDays(todayIso(), 4), [2]);
    const friday = addDays(tuesday, 3);
    const buyer = await person(browser, buyerUrl(s));
    try {
      await buyer.page.getByLabel('Needed on').fill(friday);
      const milk = buyer.page.getByTestId(`offer-${MILK}`);
      await expect(milk).toHaveAttribute('data-available', 'false');
      await expect(milk.getByTestId('nearest-earlier')).toContainText(shortDay(addDays(tuesday, 2))); // Tuesday's delivery lasts to Thursday
      await expect(milk.getByTestId('nearest-later')).toContainText(shortDay(addDays(tuesday, 7)));

      // The dairy says its milk keeps for five days
      const r = await request.put(`/api/listings/${encodeURIComponent(MILK)}`, { headers: { 'x-session': s, 'x-persona': 'dyfed-dairy' }, data: { shelfLifeDays: 5 } });
      expect(r.ok()).toBe(true);
      await expect(milk).toHaveAttribute('data-available', 'true', { timeout: 10_000 });
      await expect(milk.getByTestId('shelf-life')).toHaveText('Good for 5 days after delivery');
      await expect(milk.getByTestId('delivered-on')).toContainText(shortDay(tuesday));
    } finally {
      await buyer.close();
    }
  });

  test('the basket totals up, applies minimum orders, and survives a reload', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await addMilk(page, 12);
    const cart = page.getByTestId('cart');
    await expect(cart.getByTestId('cart-total')).toHaveText('£11.40'); // 12 x £0.95
    await cart.getByLabel(/^Quantity/).fill('15');
    await expect(cart.getByTestId('cart-total')).toHaveText('£14.25');
    await cart.getByLabel(/^Quantity/).fill('4'); // below the minimum order of 10
    await expect(cart.getByRole('alert')).toContainText('min 10');
    await expect(cart.getByRole('button', { name: 'Place order' })).toBeDisabled();
    await cart.getByLabel(/^Quantity/).fill('10');
    await page.reload();
    await expect(page.getByTestId('cart').getByTestId('cart-total')).toHaveText('£9.50');
    await page.getByTestId('cart').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('cart')).toContainText('Your basket is empty');
  });

  test('one checkout with two producers becomes two orders (separate invoices), or one invoice under the hub model', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await addMilk(page, 10);
    const lamb = page.getByTestId('offer-teifi-butchers:meat-lamb');
    await lamb.getByLabel(/^Quantity/).fill('3');
    await lamb.getByRole('button', { name: 'Add' }).click();
    const cart = page.getByTestId('cart');
    await expect(cart).toContainText('2 separate invoices');
    await expect(cart).toContainText('2 separate deliveries');
    await request.put('/api/config', { headers: { 'x-session': s, 'x-persona': 'operator' }, data: { operator: 'hub' } });
    await expect(cart).toContainText('One invoice from the network', { timeout: 10_000 });
    await expect(cart).toContainText('One consolidated delivery');
    await cart.getByRole('button', { name: 'Place order' }).click();
    await expect(cart.getByTestId('placed-refs')).toContainText(/BL-\d+, BL-\d+/);
    await cart.getByRole('button', { name: 'OK' }).click();
    await page.getByRole('tab', { name: /My orders/ }).click();
    await expect(page.getByText(/Placed together/)).toContainText('One invoice from the network');
  });
});

test.describe('buyer: placing orders and watching stock', () => {
  test('order → producer confirms → buyer sees it confirmed, and the producer stock drops', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, producerUrl(s));
    try {
      const milkCard = producer.page.getByTestId(`stock-${MILK}`);
      const cell = milkCard.getByTestId(`week-${WEEK}`);
      await expect(cell).toBeVisible();
      await expect(cell.getByText(/reserved/)).toHaveCount(0);

      await addMilk(buyer.page, 12);
      const cart = buyer.page.getByTestId('cart');
      await cart.getByRole('button', { name: 'Place order' }).click();
      const ref = (await cart.getByTestId('placed-refs').textContent())!.trim();
      expect(ref).toMatch(/^BL-\d+$/);

      // Default model: nothing is reserved until the producer confirms
      await expect(producer.page.getByRole('tab', { name: 'Orders (1)' })).toBeVisible({ timeout: 10_000 });
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const inbox = producer.page.getByTestId(`order-${ref}`);
      await expect(inbox).toContainText('Corner Deli');
      await inbox.getByRole('button', { name: 'Confirm' }).click();
      await expect(inbox.getByTestId('order-status')).toHaveText('Confirmed');

      await producer.page.getByRole('tab', { name: 'Stock & forecast' }).click();
      await expect(producer.page.getByTestId(`stock-${MILK}`).getByTestId(`week-${WEEK}`).getByText('12 reserved')).toBeVisible({ timeout: 10_000 });

      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.getByTestId(`order-${ref}`).getByTestId('order-status')).toHaveText('Confirmed', { timeout: 10_000 });
      await expect(buyer.page.getByTestId(`order-${ref}`)).toContainText('Stock reserved');
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('under the on-placement model the order is accepted and stock drops immediately', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, producerUrl(s));
    try {
      await addMilk(buyer.page, 20);
      await buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      await expect(buyer.page.getByTestId('placed-refs')).toBeVisible();
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.getByTestId('order-status').first()).toHaveText('Confirmed');
      await expect(producer.page.getByTestId(`stock-${MILK}`).getByTestId(`week-${WEEK}`).getByText('20 reserved')).toBeVisible({ timeout: 10_000 });
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('the buyer sees remaining availability fall after another buyer orders', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const a = await person(browser, buyerUrl(s, 'corner-deli'));
    const b = await person(browser, buyerUrl(s, 'grand-hotel'));
    try {
      const offerB = b.page.getByTestId(`offer-${MILK}`);
      await expect(offerB).toContainText(/\d+ available/);
      const before = Number(/(\d+) available/.exec((await offerB.textContent())!)![1]);
      await addMilk(a.page, 30);
      await a.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      await expect(a.page.getByTestId('placed-refs')).toBeVisible();
      await expect(offerB).toContainText(`${before - 30} available`, { timeout: 15_000 }); // B never reloaded
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('a producer can decline with a reason, and the buyer sees it', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, producerUrl(s));
    try {
      await addMilk(buyer.page, 10);
      await buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      const ref = (await buyer.page.getByTestId('placed-refs').textContent())!.trim();
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const card = producer.page.getByTestId(`order-${ref}`);
      await card.getByRole('button', { name: 'Decline' }).click();
      await card.getByLabel('Reason (optional)').fill('Cows off milk this week');
      await card.getByRole('button', { name: 'Decline order' }).click();
      await expect(card.getByTestId('order-status')).toHaveText('Declined');
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      const mine = buyer.page.getByTestId(`order-${ref}`);
      await expect(mine.getByTestId('order-status')).toHaveText('Declined', { timeout: 10_000 });
      await expect(mine).toContainText('Cows off milk this week');
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('a buyer can cancel a confirmed order and the stock comes back', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, producerUrl(s));
    try {
      await addMilk(buyer.page, 20);
      await buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      await expect(producer.page.getByTestId(`stock-${MILK}`).getByTestId(`week-${WEEK}`).getByText('20 reserved')).toBeVisible({ timeout: 10_000 });
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      buyer.page.once('dialog', (d) => d.accept());
      await buyer.page.getByRole('button', { name: 'Cancel order' }).click();
      await expect(buyer.page.getByTestId('order-status').first()).toHaveText('Cancelled');
      await expect(producer.page.getByTestId(`stock-${MILK}`).getByTestId(`week-${WEEK}`).getByText(/reserved/)).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('a basket line is flagged when stock has gone by the time you check out', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const a = await person(browser, buyerUrl(s, 'corner-deli'));
    const b = await person(browser, buyerUrl(s, 'grand-hotel'));
    try {
      const offerB = b.page.getByTestId(`offer-${MILK}`);
      await expect(offerB).toContainText(/\d+ available/);
      const total = Number(/(\d+) available/.exec((await offerB.textContent())!)![1]);
      await addMilk(b.page, total); // B plans to take it all
      await addMilk(a.page, total); // A takes it first
      await a.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      await expect(a.page.getByTestId('placed-refs')).toBeVisible();
      const line = b.page.getByTestId('cart').getByTestId(`cart-line-${MILK}`);
      await expect(line.getByRole('alert')).toContainText(/Sold out|Only 0 available/, { timeout: 15_000 });
      await expect(b.page.getByTestId('cart').getByRole('button', { name: 'Place order' })).toBeDisabled();
    } finally {
      await a.close();
      await b.close();
    }
  });
});

test.describe('buyer: menu planner', () => {
  test('shows availability by week and jumps to ordering for that week', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await page.getByRole('tab', { name: 'Menu planner' }).click();
    const planner = page.getByTestId('planner');
    await expect(planner.getByTestId('planner-milk-whole')).toBeVisible();
    // This week and next are in stock (green); two weeks on is forecast (amber); a month on is only planned
    await expect(planner.getByTestId(`cell-milk-whole-${mondayOf(todayIso())}`)).toHaveAttribute('data-conf', 'in_stock');
    await expect(planner.getByTestId(`cell-milk-whole-${addDays(mondayOf(todayIso()), 14)}`)).toHaveAttribute('data-conf', 'forecast');
    await expect(planner.getByTestId('planner-milk-whole').locator('[data-conf="provisional"]').first()).toBeVisible();

    await planner.getByTestId(`cell-milk-whole-${addDays(mondayOf(todayIso()), 14)}`).click();
    await expect(page.getByRole('tab', { name: 'Browse' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Search products')).toHaveValue('Whole milk');
    const chosen = await page.getByLabel('Needed on').inputValue();
    expect(mondayOf(chosen)).toBe(addDays(mondayOf(todayIso()), 14));
    await expect(page.getByTestId(`offer-${MILK}`).getByTestId('stock-flag')).toContainText('Forecast');
    await expect(page.getByTestId(`offer-${MILK}`)).toContainText('Forecast');
  });

  test('usual items can be starred and filtered', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await page.getByRole('tab', { name: 'Menu planner' }).click();
    const rows = page.getByTestId('planner').locator('tbody tr');
    const all = await rows.count();
    await page.getByTestId('planner-milk-whole').getByRole('button', { name: 'Usual item' }).click();
    await page.getByLabel('Only my usual items').check();
    await expect(rows).toHaveCount(1);
    await page.reload();
    await page.getByRole('tab', { name: 'Menu planner' }).click();
    await page.getByLabel('Only my usual items').check();
    await expect(rows).toHaveCount(1); // remembered
    await page.getByLabel('Only my usual items').uncheck();
    await expect(rows).toHaveCount(all);
  });
});

test.describe('buyer: rules follow the model', () => {
  test('forecast stock is orderable only up to the model limit', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { forecastOrdering: 'stock_only' });
    const buyer = await person(browser, buyerUrl(s));
    try {
      const forecastDay = nextWeekday(addDays(mondayOf(todayIso()), 14), [4]); // a week seeded as forecast
      await buyer.page.getByLabel('Needed on').fill(forecastDay);
      const milk = buyer.page.getByTestId(`offer-${MILK}`);
      // Milk keeps only two days, so with forecast stock off the table nothing delivers in that week
      await expect(milk).toHaveAttribute('data-available', 'false');
      await expect(milk.getByTestId('why-not')).toContainText('Not available for');
      await request.put('/api/config', { headers: { 'x-session': s, 'x-persona': 'operator' }, data: { forecastOrdering: 'full_forecast' } });
      await expect(milk.getByRole('button', { name: 'Add' })).toBeVisible({ timeout: 10_000 });
      await expect(milk.getByTestId('stock-flag')).toContainText('Forecast');
    } finally {
      await buyer.close();
    }
  });

  test('volume tiers change the price in the basket', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { pricing: 'tiers' });
    await request.put(`/api/listings/${encodeURIComponent(MILK)}`, {
      headers: { 'x-session': s, 'x-persona': 'dyfed-dairy' }, data: { tiers: [{ minQty: 50, price: 0.8 }] },
    });
    const buyer = await person(browser, buyerUrl(s));
    try {
      await expect(buyer.page.getByTestId(`offer-${MILK}`)).toContainText('50+ at £0.80');
      await addMilk(buyer.page, 10);
      await expect(buyer.page.getByTestId('cart-total')).toHaveText('£9.50');
      await buyer.page.getByTestId('cart').getByLabel(/^Quantity/).fill('50');
      await expect(buyer.page.getByTestId('cart-total')).toHaveText('£40.00');
    } finally {
      await buyer.close();
    }
  });
});
