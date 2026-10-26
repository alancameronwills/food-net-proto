import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { addDays, todayIso } from '../src/shared/dates';
import { nextWeekday } from '../src/shared/orders';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-d${n++}-${Math.random().toString(36).slice(2, 6)}`;
const THURSDAY = nextWeekday(addDays(todayIso(), 3), [4]);
const FRIDAY = addDays(THURSDAY, 1);
const MILK = 'dyfed-dairy:milk-whole';
const LAMB = 'teifi-butchers:meat-lamb';
const as = (s: string, persona: string) => ({ 'x-session': s, 'x-persona': persona });
const buyerUrl = (s: string, who = 'grand-hotel') => `/home?s=${s}&as=${who}`; // Grand Hotel is in the "Cardigan & Teifi estuary" area

async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}
async function setModel(request: APIRequestContext, s: string, config: Record<string, unknown> = {}) {
  const r = await request.put('/api/config', { headers: as(s, 'operator'), data: { localRange: 'flat', flatRadiusKm: 200, ...config } });
  expect(r.ok()).toBe(true);
}
async function order(request: APIRequestContext, s: string, listingId: string, qty: number, date = THURSDAY, buyer = 'grand-hotel') {
  const r = await request.post('/api/orders', { headers: as(s, buyer), data: { deliveryDate: date, lines: [{ listingId, qty }] } });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).orders[0].id as string;
}
const dayButton = (page: import('@playwright/test').Page, d: string) => page.getByTestId(`day-${d}`);

test.describe('delivery day strip', () => {
  test('shows how much can be ordered on each day, and picks the date', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await expect(page.getByTestId('day-strip').locator('button')).toHaveCount(14);
    const thursday = dayButton(page, THURSDAY);
    await expect(thursday).toHaveAttribute('data-count', /^[1-9]\d*$/);
    await dayButton(page, FRIDAY).click();
    await expect(page.getByTestId('delivery-long')).toContainText('Friday');
    await expect(dayButton(page, FRIDAY)).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('delivery model: area days', () => {
  test('buyers see the producer round for their area and can only order on those days', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'producer' });
    const buyer = await person(browser, buyerUrl(s));
    try {
      const offer = buyer.page.getByTestId(`offer-${MILK}`);
      await buyer.page.getByLabel('Only what I can order').uncheck();
      await dayButton(buyer.page, FRIDAY).click();
      await expect(offer.getByRole('button', { name: 'Add' })).toBeVisible(); // producer delivers: milk goes out on Fridays
      const friday = Number(await dayButton(buyer.page, FRIDAY).getAttribute('data-count'));

      await request.put('/api/config', { headers: as(s, 'operator'), data: { delivery: 'area_days' } });
      await expect(offer.getByTestId('why-not')).toHaveText('Not on this producer’s round to your area that day', { timeout: 10_000 });
      await expect(offer.getByTestId('route-info')).toHaveText('Delivers to your area: Mon, Thu');
      expect(Number(await dayButton(buyer.page, FRIDAY).getAttribute('data-count'))).toBeLessThan(friday); // fewer offers on a day

      await dayButton(buyer.page, THURSDAY).click();
      await expect(offer.getByRole('button', { name: 'Add' })).toBeVisible();
      await offer.getByLabel(/^Quantity/).fill('10');
      await offer.getByRole('button', { name: 'Add' }).click();
      await expect(buyer.page.getByTestId('cart-delivery-mode')).toHaveText('Producers deliver on their published rounds for your area.');
      await buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      await expect(buyer.page.getByTestId('placed-refs')).toBeVisible();
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.getByTestId('delivery-mode').first()).toHaveText('Delivered on the producer’s round');
    } finally {
      await buyer.close();
    }
  });

  test('a buyer in another area sees a different round', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'area_days' });
    const bistro = await person(browser, buyerUrl(s, 'harbour-bistro')); // Fishguard & Preseli coast
    try {
      await bistro.page.getByLabel('Only what I can order').uncheck();
      await expect(bistro.page.getByTestId(`offer-${MILK}`).getByTestId('route-info')).toHaveText('Delivers to your area: Tue, Fri');
    } finally {
      await bistro.close();
    }
  });

  test('the menu planner jumps to a day the producer actually delivers', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'area_days' });
    const hotel = await person(browser, buyerUrl(s));
    try {
      await hotel.page.getByRole('tab', { name: 'Menu planner' }).click();
      const cell = hotel.page.getByTestId('planner-milk-whole').locator('button[data-testid^="cell-"]').first();
      await cell.click();
      const picked = await hotel.page.getByLabel('Delivery date').first().inputValue();
      const dow = new Date(picked + 'T00:00:00Z').getUTCDay();
      // Milk for the Teifi estuary comes on Dyfed Dairy's round (Mon, Thu) or Brongest Creamery's (Tue, Fri); never on a Wednesday or weekend
      expect([1, 2, 4, 5]).toContain(dow);
      await expect(hotel.page.getByTestId('offer-dyfed-dairy:milk-whole').or(hotel.page.getByTestId('offer-brongest-creamery:milk-whole')).first()).toBeVisible();
    } finally {
      await hotel.close();
    }
  });
});

test.describe('delivery model: hub courier', () => {
  test('only hub days can be ordered, and the operator controls them', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'hub_courier', hubDays: [2, 4, 6] });
    const buyer = await person(browser, buyerUrl(s));
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      await expect(buyer.page.getByTestId('hub-info')).toContainText('Tue, Thu, Sat');
      await buyer.page.getByLabel('Only what I can order').uncheck();
      await dayButton(buyer.page, FRIDAY).click();
      await expect(buyer.page.getByTestId(`offer-${MILK}`).getByTestId('why-not')).toHaveText('Not a hub courier day');
      await dayButton(buyer.page, THURSDAY).click();
      await expect(buyer.page.getByTestId(`offer-${MILK}`).getByRole('button', { name: 'Add' })).toBeVisible();

      // The operator adds Fridays to the hub round
      await op.page.getByTestId('hub-days').getByRole('button', { name: 'Fri' }).click();
      await expect(buyer.page.getByTestId('hub-info')).toContainText('Tue, Thu, Fri, Sat', { timeout: 10_000 });
      await dayButton(buyer.page, FRIDAY).click();
      await expect(buyer.page.getByTestId(`offer-${MILK}`).getByRole('button', { name: 'Add' })).toBeVisible({ timeout: 10_000 });
    } finally {
      await buyer.close();
      await op.close();
    }
  });

  test('one consolidated delivery, and the operator sees the drops saved', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'hub_courier', stockTrigger: 'on_place' });
    await order(request, s, MILK, 10);
    await order(request, s, LAMB, 3);
    await order(request, s, MILK, 10, THURSDAY, 'corner-deli');
    const buyer = await person(browser, buyerUrl(s));
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      await buyer.page.getByTestId(`offer-${LAMB}`).getByLabel(/^Quantity/).fill('3');
      await buyer.page.getByTestId(`offer-${LAMB}`).getByRole('button', { name: 'Add' }).click();
      await expect(buyer.page.getByTestId('cart')).toContainText('One consolidated delivery');
      await expect(buyer.page.getByTestId('cart-delivery-mode')).toContainText('The hub courier delivers on Tue, Thu, Sat.');

      await op.page.getByRole('tab', { name: 'Delivery runs' }).click();
      const run = op.page.getByTestId(`run-${THURSDAY}`);
      await expect(run).toBeVisible();
      await expect(run.getByTestId('drops')).toContainText('3 drops if every producer delivers separately');
      await expect(run.getByTestId('drops')).toContainText('2 drops with one round per buyer');
      await expect(run.getByTestId(`stop-${THURSDAY}-grand-hotel`)).toContainText('Whole milk');
      await expect(run.getByTestId(`stop-${THURSDAY}-grand-hotel`)).toContainText('Salt-marsh lamb shoulder');
      await expect(run.getByTestId(`stop-${THURSDAY}-grand-hotel`)).toContainText('from Teifi Butchers');
    } finally {
      await buyer.close();
      await op.close();
    }
  });
});

test.describe('producer run sheet', () => {
  test('lists the confirmed deliveries by date and buyer', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    await order(request, s, MILK, 10);
    await order(request, s, MILK, 20, THURSDAY, 'corner-deli');
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const run = producer.page.getByTestId(`run-${THURSDAY}`);
      await expect(run).toBeVisible();
      await expect(run.getByTestId(`stop-${THURSDAY}-grand-hotel`)).toContainText('10 litre Whole milk');
      await expect(run.getByTestId(`stop-${THURSDAY}-grand-hotel`)).toContainText('Cardigan & Teifi estuary');
      await expect(run.getByTestId(`stop-${THURSDAY}-corner-deli`)).toContainText('20 litre Whole milk');
      await expect(run.getByTestId('drops')).toHaveCount(0); // a producer sees their own van, not the network totals
    } finally {
      await producer.close();
    }
  });

  test('says so when there are no orders at all', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      await expect(producer.page.getByText(/No orders yet/)).toBeVisible(); // nothing at all yet
    } finally {
      await producer.close();
    }
  });
});
