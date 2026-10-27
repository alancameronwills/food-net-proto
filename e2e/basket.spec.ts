import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { addDays, todayIso } from '../src/shared/dates';
import { nextWeekday } from '../src/shared/orders';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-k${n++}-${Math.random().toString(36).slice(2, 6)}`;
const MILK = 'dyfed-dairy:milk-whole';
const LAMB = 'teifi-butchers:meat-lamb';
const THURSDAY = nextWeekday(addDays(todayIso(), 3), [4]); // the day the buyer is shopping for by default
const as = (s: string, persona: string) => ({ 'x-session': s, 'x-persona': persona });
const buyerUrl = (s: string, who = 'corner-deli') => `/home?s=${s}&as=${who}`;
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');

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
async function add(page: Page, listingId: string, qty: number) {
  const offer = page.getByTestId(`offer-${listingId}`);
  await offer.getByLabel(/^Quantity/).fill(String(qty));
  await offer.getByRole('button', { name: 'Add' }).click();
}

test.describe('a basket with a delivery day and a note for each item', () => {
  test('each item picks its own delivery day from the days it can arrive and still be good', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await add(page, MILK, 10);
    const line = page.getByTestId(`cart-line-${MILK}`);
    // Needed on a Thursday, milk is good for two days, and the dairy delivers Mon-Sat: Tue, Wed or Thu
    const options = line.getByTestId('line-date').locator('option');
    await expect(options).toHaveText([dayLabel(addDays(THURSDAY, -2)), dayLabel(addDays(THURSDAY, -1)), dayLabel(THURSDAY)]);
    await expect(line.getByTestId('line-date')).toHaveValue(THURSDAY); // the freshest by default
    await expect(line.getByTestId('line-use')).toContainText(`for use on ${dayLabel(THURSDAY)}, good for 2 days`);
    await line.getByTestId('line-date').selectOption(addDays(THURSDAY, -2));
    await expect(line.getByTestId('line-date')).toHaveValue(addDays(THURSDAY, -2));
  });

  test('the same item can come on two days as two lines, and moving one onto the other combines them', async ({ page, request }) => {
    const s = newSession();
    await setModel(request, s);
    await page.goto(buyerUrl(s));
    await add(page, MILK, 10); // needed Thursday, delivered Thursday
    const next = addDays(THURSDAY, 7);
    await page.getByLabel('Needed on').fill(next);
    await add(page, MILK, 20); // needed next Thursday, a week later
    const lines = page.getByTestId('cart').getByTestId(`cart-line-${MILK}`);
    await expect(lines).toHaveCount(2);
    await expect(page.getByTestId('cart-deliveries')).toHaveText('2 separate deliveries');
    await expect(page.getByTestId('cart-total')).toHaveText('£28.50'); // 30 litres at £0.95

    // A third batch (milk's minimum order is 10), needed on the Friday: it arrives Friday, but Thursday works too (milk keeps two days)
    await page.getByLabel('Needed on').fill(addDays(THURSDAY, 1));
    await add(page, MILK, 10);
    await expect(lines).toHaveCount(3);
    // Move that one onto Thursday: it joins the 10 litres already coming that day
    const fridayLine = lines.nth(2);
    await expect(fridayLine.getByTestId('line-date')).toHaveValue(addDays(THURSDAY, 1));
    await fridayLine.getByTestId('line-date').selectOption(THURSDAY);
    await expect(lines).toHaveCount(2);
    const quantities = await page.getByTestId('cart').getByLabel('Quantity Whole milk').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).sort());
    expect(quantities).toEqual(['20', '20']); // 10 + 10 on Thursday, and next week's 20
    await expect(page.getByTestId('cart-deliveries')).toHaveText('2 separate deliveries');
    await expect(page.getByTestId('cart-total')).toHaveText('£38.00'); // 40 litres
  });

  test('checkout makes one order per producer and day; each item keeps its own note for the producer', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await add(buyer.page, MILK, 10);
      await buyer.page.getByLabel('Needed on').fill(addDays(THURSDAY, 7));
      await add(buyer.page, MILK, 20);
      await add(buyer.page, LAMB, 3);

      const cart = buyer.page.getByTestId('cart');
      const milk = cart.getByTestId(`cart-line-${MILK}`);
      await milk.nth(0).getByLabel(/^Note for the producer about/).fill('Back door, please');
      await milk.nth(1).getByLabel(/^Note for the producer about/).fill('Need it before 7am');
      await expect(cart.getByTestId('cart-deliveries')).toHaveText('3 separate deliveries'); // Dyfed twice, Teifi Butchers once
      await cart.getByRole('button', { name: 'Place order' }).click();
      await expect(cart.getByTestId('placed-refs')).toContainText(/BL-\d+, BL-\d+, BL-\d+/);

      // The buyer sees three orders placed together
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.getByText(/Placed together/)).toBeVisible();
      await expect(buyer.page.locator('[data-testid^="order-BL-"]')).toHaveCount(3);

      // The dairy sees two orders, each with only its own item's note
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const cards = producer.page.locator('[data-testid^="order-BL-"]');
      await expect(cards).toHaveCount(2, { timeout: 10_000 });
      const notes = await cards.getByTestId('line-note').allTextContents();
      expect(notes.sort()).toEqual(['“Back door, please”', '“Need it before 7am”']);
      for (const card of await cards.all()) await expect(card.getByTestId('line-note')).toHaveCount(1);
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('notes reach the producer’s run sheet, and the basket survives a reload', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const buyer = await person(browser, buyerUrl(s));
    try {
      await add(buyer.page, MILK, 10);
      await buyer.page.getByTestId('cart').getByLabel(/^Note for the producer about/).fill('Ring the bell');
      await buyer.page.reload();
      const line = buyer.page.getByTestId(`cart-line-${MILK}`);
      await expect(line.getByLabel(/^Note for the producer about/)).toHaveValue('Ring the bell');
      await expect(line.getByTestId('line-date')).toHaveValue(THURSDAY);
      await buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      await expect(buyer.page.getByTestId('placed-refs')).toBeVisible();

      const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      await expect(producer.page.getByTestId(`run-${THURSDAY}`).getByTestId('run-note')).toContainText('Ring the bell');
      await producer.close();
    } finally {
      await buyer.close();
    }
  });

  test('a day that stops working while it is in the basket is flagged, and the item can be moved', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'hub_courier', hubDays: [2, 4] }); // Tuesdays and Thursdays
    const buyer = await person(browser, buyerUrl(s));
    try {
      await add(buyer.page, MILK, 10); // needed on a Thursday: delivered Thursday, or Tuesday
      const line = buyer.page.getByTestId(`cart-line-${MILK}`);
      await expect(line.getByTestId('line-date')).toHaveValue(THURSDAY);
      await expect(buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' })).toBeEnabled();

      // The hub drops its Thursday round
      await request.put('/api/config', { headers: as(s, 'operator'), data: { hubDays: [2] } });
      await expect(line.getByRole('alert')).toContainText('Problem', { timeout: 10_000 });
      await expect(buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' })).toBeDisabled();

      // Moving it to the Tuesday round fixes it
      await line.getByTestId('line-date').selectOption(addDays(THURSDAY, -2));
      await expect(line.getByRole('alert')).toHaveCount(0);
      await expect(buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' })).toBeEnabled();
    } finally {
      await buyer.close();
    }
  });
});

test.describe('producers set the shelf life', () => {
  test('on a listing, with the usual shown when blank, and buyers see it straight away', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    const buyer = await person(browser, buyerUrl(s));
    try {
      await producer.page.getByRole('tab', { name: 'My listings' }).click();
      const row = producer.page.getByTestId(`listing-${MILK}`);
      await expect(row.getByTestId('shelf')).toHaveText('Good for 2 days (usual for this product)');
      await row.getByRole('button', { name: 'Edit' }).click();
      await producer.page.getByLabel('Shelf life (days)').fill('60');
      await expect(producer.page.getByText('= 2 months')).toBeVisible();
      await producer.page.getByRole('button', { name: 'Save' }).click();
      await expect(row.getByTestId('shelf')).toHaveText('Good for 2 months');
      await expect(buyer.page.getByTestId(`offer-${MILK}`).getByTestId('shelf-life')).toHaveText('Good for 2 months after delivery', { timeout: 10_000 });

      // Back to the usual by clearing the box
      await row.getByRole('button', { name: 'Edit' }).click();
      await producer.page.getByLabel('Shelf life (days)').fill('');
      await producer.page.getByRole('button', { name: 'Save' }).click();
      await expect(row.getByTestId('shelf')).toHaveText('Good for 2 days (usual for this product)');
    } finally {
      await producer.close();
      await buyer.close();
    }
  });

  test('a new listing can be given a shelf life, and a silly one is refused', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await producer.page.getByRole('tab', { name: 'My listings' }).click();
      await producer.page.getByRole('button', { name: 'Add a product to sell' }).click();
      await producer.page.getByLabel('Product').selectOption({ label: 'Salt-marsh lamb shoulder' });
      await producer.page.getByLabel(/Price per unit/).fill('16');
      await producer.page.getByLabel('Shelf life (days)').fill('9');
      await producer.page.getByRole('button', { name: 'Save' }).click();
      await expect(producer.page.getByTestId('listing-dyfed-dairy:meat-lamb').getByTestId('shelf')).toHaveText('Good for 9 days');
      const r = await request.put('/api/listings/dyfed-dairy%3Ameat-lamb', { headers: as(s, 'dyfed-dairy'), data: { shelfLifeDays: 0 } });
      expect(r.status()).toBe(400);
    } finally {
      await producer.close();
    }
  });
});
