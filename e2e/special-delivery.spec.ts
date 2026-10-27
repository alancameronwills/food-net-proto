import { expect, test, type Browser } from '@playwright/test';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { nextWeekday } from '../src/shared/orders';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-v${n++}-${Math.random().toString(36).slice(2, 6)}`;
const as = (s: string, persona: string) => ({ 'x-session': s, 'x-persona': persona });
const slow = { timeout: 30_000 };
// Cheese is delivered on Wednesdays; this is the Thursday three weeks out, which it is not
const NEEDED = nextWeekday(addDays(todayIso(), 21), [4]);
const WEDNESDAY = addDays(NEEDED, -1);
const SUNDAY = addDays(NEEDED, 3);
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');

async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}
async function setModel(request: import('@playwright/test').APIRequestContext, s: string, config: Record<string, unknown> = {}) {
  expect((await request.put('/api/config', { headers: as(s, 'operator'), data: { localRange: 'flat', flatRadiusKm: 200, ...config } })).ok()).toBe(true);
}

test.describe('asking for something on a day it is not normally delivered', () => {
  test('the request is accepted with a friendly note; producers may offer a different day', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const form = buyer.page.getByTestId('request-form');
      await form.getByLabel('Product').selectOption({ label: 'Blue cheese' });
      await form.getByLabel(/^Quantity/).fill('5');
      await form.getByLabel('Needed on').fill(NEEDED);
      const note = form.getByTestId('date-note');
      await expect(note).toContainText('Blue cheese is not normally delivered on');
      await expect(note).toContainText('earlier one will do if it keeps long enough');
      await expect(note).toContainText('special delivery');

      await form.getByRole('button', { name: 'Send request' }).click();
      const card = buyer.page.locator('[data-testid^="request-DR-"]').first();
      await expect(card).toBeVisible();
      await expect(form.getByRole('alert')).toHaveCount(0); // not an error
      await expect(card.getByTestId('request-date-note')).toContainText('Producers may offer a different delivery day');
    } finally {
      await buyer.close();
    }
  });

  test('a usual day gets no such note', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const form = buyer.page.getByTestId('request-form');
      await form.getByLabel('Product').selectOption({ label: 'Blue cheese' });
      await form.getByLabel('Needed on').fill(WEDNESDAY);
      await expect(form.getByTestId('date-note')).toHaveCount(0);
      await form.getByLabel('Needed on').fill(addDays(todayIso(), 1)); // tomorrow: short notice for cheese
      await expect(form.getByTestId('date-note')).toContainText('short notice');
    } finally {
      await buyer.close();
    }
  });

  test('a bid can offer an earlier day that still keeps; the buyer sees how it fits and accepts it', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const made = await request.post('/api/requests', { headers: as(s, 'corner-deli'), data: { productId: 'cheese-blue', qty: 4, deliveryDate: NEEDED } });
    const id = (await made.json()).request.id as string;
    const producer = await person(browser, `/home?s=${s}&as=brongest-creamery`); // Brongest Creamery makes the blue cheese
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await producer.page.getByRole('tab', { name: /^Demand board/ }).click();
      const card = producer.page.getByTestId(`demand-${id}`);
      await expect(card.getByTestId('bid-day')).toHaveValue(NEEDED); // the day asked for, unless changed
      await card.getByLabel(/^Your price/).fill('17');
      await card.getByTestId('bid-day').fill(WEDNESDAY);
      await expect(card.getByTestId('bid-day-note')).toContainText('earlier than the day needed');
      await expect(card.getByTestId('bid-day-note')).toContainText('keeps 2 months');
      await card.getByRole('button', { name: 'Place bid' }).click();
      await expect(card.getByTestId('my-bid-day')).toContainText(`Delivers ${dayLabel(WEDNESDAY)}`);

      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const delivery = buyer.page.getByTestId(`bid-delivery-${id}-brongest-creamery`);
      await expect(delivery).toContainText(`Delivers ${dayLabel(WEDNESDAY)}`, slow);
      await expect(delivery.getByTestId('bid-fit')).toHaveAttribute('data-fit', 'early');
      await expect(delivery.getByTestId('bid-fit')).toContainText('keeps 2 months');
      await buyer.page.getByTestId(`bid-${id}-brongest-creamery`).getByRole('button', { name: 'Accept bid' }).click();

      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      const order = buyer.page.locator('[data-testid^="order-BL-"]').first();
      await expect(order).toContainText(`Delivery: ${new Date(WEDNESDAY + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`); // orders show the day as "18 Nov"
      await expect(order.getByTestId('order-status')).toHaveText('Confirmed');
    } finally {
      await producer.close();
      await buyer.close();
    }
  });

  test('a bid on a day outside the producer\'s usual days is a special delivery, and says so to everyone', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const made = await request.post('/api/requests', { headers: as(s, 'corner-deli'), data: { productId: 'cheese-blue', qty: 4, deliveryDate: NEEDED } });
    const id = (await made.json()).request.id as string;
    const producer = await person(browser, `/home?s=${s}&as=brongest-creamery`);
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await producer.page.getByRole('tab', { name: /^Demand board/ }).click();
      const card = producer.page.getByTestId(`demand-${id}`);
      await card.getByLabel(/^Your price/).fill('17');
      await card.getByTestId('bid-day').fill(SUNDAY); // a Sunday, after the day needed
      await expect(card.getByTestId('bid-day-note')).toContainText('special delivery');
      await expect(card.getByTestId('bid-day-note')).toContainText('after the day needed');
      await card.getByRole('button', { name: 'Place bid' }).click();

      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const delivery = buyer.page.getByTestId(`bid-delivery-${id}-brongest-creamery`);
      await expect(delivery.getByTestId('bid-special')).toHaveText('Special delivery', slow);
      await expect(delivery.getByTestId('bid-fit')).toHaveAttribute('data-fit', 'late');
      await buyer.page.getByTestId(`bid-${id}-brongest-creamery`).getByRole('button', { name: 'Accept bid' }).click();

      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.locator('[data-testid^="order-BL-"]').first().getByTestId('special-chip')).toBeVisible();
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      await expect(producer.page.locator('[data-testid^="order-BL-"]').first().getByTestId('special-chip')).toBeVisible(slow);
      await expect(producer.page.getByTestId(`run-${SUNDAY}`)).toBeVisible(); // and it is on the van's run sheet for that day
    } finally {
      await producer.close();
      await buyer.close();
    }
  });
});

test.describe('a producer adds a special delivery day', () => {
  // Under the area rounds Dyfed Dairy goes to the Teifi estuary on Mondays and Thursdays. Milk keeps two days, so
  // a Sunday is out of reach (Thursday is three days earlier) until the dairy adds the Saturday.
  const sunday = nextWeekday(addDays(todayIso(), 10), [0]);
  const saturday = addDays(sunday, -1);

  test('it appears in the buyer\'s Browse, marked special, and removing it takes it away again', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'area_days' });
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    const buyer = await person(browser, `/home?s=${s}&as=grand-hotel`);
    try {
      await buyer.page.getByLabel('Needed on').fill(sunday);
      const milk = buyer.page.getByTestId('offer-dyfed-dairy:milk-whole');
      await expect(milk).toHaveAttribute('data-available', 'false');

      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const panel = producer.page.getByTestId('extra-days');
      await expect(panel).toContainText('Special delivery days');
      await panel.getByLabel('Day').fill(saturday);
      await panel.getByLabel('Note').fill('Delivering to Cardigan anyway');
      await panel.getByRole('button', { name: 'Add day' }).click();
      await expect(panel.getByTestId(`extra-day-${saturday}`)).toContainText('Delivering to Cardigan anyway');

      await expect(milk).toHaveAttribute('data-available', 'true', slow);
      await expect(milk.getByTestId('delivered-on')).toContainText(dayLabel(saturday));
      await expect(milk.getByTestId('special-tag')).toHaveText('Special delivery');

      // Other producers' products are unaffected
      await expect(buyer.page.getByTestId('offer-brongest-creamery:milk-whole').getByTestId('special-tag')).toHaveCount(0);

      await panel.getByTestId(`extra-day-${saturday}`).getByRole('button', { name: 'Remove' }).click();
      await expect(panel.getByTestId(`extra-day-${saturday}`)).toHaveCount(0);
      await expect(milk).toHaveAttribute('data-available', 'false', slow);
    } finally {
      await producer.close();
      await buyer.close();
    }
  });

  test('an order for it goes through the basket and arrives as a special delivery', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { delivery: 'area_days', stockTrigger: 'on_place' }); // accepted at once, so it is on the run sheet
    expect((await request.post('/api/extra-days', { headers: as(s, 'dyfed-dairy'), data: { date: saturday } })).ok()).toBe(true);
    const buyer = await person(browser, `/home?s=${s}&as=grand-hotel`);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await buyer.page.getByLabel('Needed on').fill(sunday);
      const milk = buyer.page.getByTestId('offer-dyfed-dairy:milk-whole');
      await milk.getByLabel(/^Quantity/).fill('10');
      await milk.getByRole('button', { name: 'Add' }).click();
      const line = buyer.page.getByTestId('cart-line-dyfed-dairy:milk-whole');
      await expect(line.getByTestId('line-date').locator('option')).toHaveText([`${dayLabel(saturday)} (special delivery)`]);
      await buyer.page.getByTestId('cart').getByRole('button', { name: 'Place order' }).click();
      await expect(buyer.page.getByTestId('placed-refs')).toBeVisible();
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const card = producer.page.locator('[data-testid^="order-BL-"]').first();
      await expect(card.getByTestId('special-chip')).toBeVisible(slow);
      await expect(producer.page.getByTestId(`run-${saturday}`)).toBeVisible();
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('bad days are refused with a clear message', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const panel = producer.page.getByTestId('extra-days');
      // The page only offers tomorrow onwards; a day typed in by hand is still checked by the server
      const r = await request.post('/api/extra-days', { headers: as(s, 'dyfed-dairy'), data: { date: todayIso() } });
      expect(r.status()).toBe(400);
      expect((await r.json()).error).toMatch(/tomorrow or later/);
      await expect(panel.getByLabel('Day')).toHaveAttribute('min', addDays(todayIso(), 1));
      await expect(panel).toContainText('No special delivery days added');
    } finally {
      await producer.close();
    }
  });
});

test.describe('the other demand screens are unchanged for usual days', () => {
  test('a normal request and bid on a usual day carries no special tag', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const made = await request.post('/api/requests', { headers: as(s, 'corner-deli'), data: { productId: 'cheese-blue', qty: 4, deliveryDate: addDays(WEDNESDAY, 0) } });
    const id = (await made.json()).request.id as string;
    await request.post(`/api/requests/${id}/bids`, { headers: as(s, 'brongest-creamery'), data: { price: 17, qty: 4 } });
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const delivery = buyer.page.getByTestId(`bid-delivery-${id}-brongest-creamery`);
      await expect(delivery).toContainText('Delivers');
      await expect(delivery.getByTestId('bid-special')).toHaveCount(0);
      await expect(delivery.getByTestId('bid-fit')).toHaveCount(0); // on the day asked for
      await expect(buyer.page.getByTestId(`request-${id}`).getByTestId('request-date-note')).toHaveCount(0);
      void mondayOf;
    } finally {
      await buyer.close();
    }
  });
});
