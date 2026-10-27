import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { nextWeekday } from '../src/shared/orders';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-r${n++}-${Math.random().toString(36).slice(2, 6)}`;
const FAR = nextWeekday(addDays(todayIso(), 21), [4]); // the form's default date: a Thursday three weeks out
const SOON = nextWeekday(addDays(todayIso(), 3), [4]);
const buyerUrl = (s: string, as = 'corner-deli') => `/home?s=${s}&as=${as}`;
const producerUrl = (s: string, as = 'dyfed-dairy') => `/home?s=${s}&as=${as}`;
const as = (s: string, persona: string) => ({ 'x-session': s, 'x-persona': persona });

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

/** Fill in and send the buyer's request form; returns the new request's reference (DR-…). */
async function askFor(page: Page, o: { product?: string; qty: number; target?: number; note?: string; date?: string }) {
  await page.getByRole('tab', { name: /^Ask for something/ }).click();
  const form = page.getByTestId('request-form');
  await form.getByLabel('Product').selectOption({ label: o.product ?? 'Whole milk' });
  await form.getByLabel(/^Quantity/).fill(String(o.qty));
  if (o.date) await form.getByLabel('Needed on').fill(o.date);
  if (o.target !== undefined) await form.getByLabel(/^Price you would pay/).fill(String(o.target));
  if (o.note) await form.getByLabel('Anything producers should know').fill(o.note);
  const before = await page.locator('[data-testid^="request-DR-"]').count();
  await form.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('[data-testid^="request-DR-"]')).toHaveCount(before + 1);
  const testId = await page.locator('[data-testid^="request-DR-"]').first().getAttribute('data-testid');
  return testId!.replace('request-', '');
}

async function bid(page: Page, id: string, price: number, qty: number, note?: string) {
  await page.getByRole('tab', { name: /^Demand board/ }).click();
  const card = page.getByTestId(`demand-${id}`);
  await card.getByLabel(/^Your price/).fill(String(price));
  await card.getByLabel(/^How many/).fill(String(qty));
  if (note) await card.getByLabel(/^Message/).fill(note);
  await card.getByRole('button', { name: 'Place bid' }).click();
  await expect(card.getByTestId('my-bid')).toContainText(`£${price.toFixed(2)} × ${qty}`);
}

test.describe('speculative orders: open RFQ', () => {
  test('ask → producers are told → bid → accept → confirmed order and new supply', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, producerUrl(s));
    try {
      const id = await askFor(buyer.page, { qty: 100, target: 0.9, note: 'For our breakfast service', date: FAR });
      const card = buyer.page.getByTestId(`request-${id}`);
      await expect(card.getByTestId('request-status')).toHaveText('Open');
      await expect(card).toContainText('Waiting for bids');

      await expect(producer.page.getByTestId('bell-count')).toHaveText('1', { timeout: 10_000 });
      await expect(producer.page.getByRole('tab', { name: 'Demand board (1)' })).toBeVisible();
      await producer.page.getByTestId('bell').click();
      await expect(producer.page.getByTestId('bell-panel')).toContainText('Corner Deli asked for 100 Whole milk');
      await bid(producer.page, id, 0.95, 100, 'Fresh every morning');
      await expect(producer.page.getByTestId(`demand-${id}`)).toContainText('1 bid(s) so far');

      const row = card.getByTestId(`bid-${id}-dyfed-dairy`);
      await expect(row).toContainText('£0.95', { timeout: 10_000 });
      await expect(row).toContainText('Fresh every morning');
      await expect(row.getByTestId('trust')).toBeVisible();
      await row.getByRole('button', { name: 'Accept bid' }).click();

      await expect(card.getByTestId('request-status')).toHaveText('Filled');
      await expect(row).toContainText('Accepted');
      await expect(row).toContainText(/Order BL-\d+/);

      // It is a normal confirmed order now
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      const order = buyer.page.locator('[data-testid^="order-BL-"]').first();
      await expect(order.getByTestId('order-status')).toHaveText('Confirmed');
      await expect(order).toContainText(id);
      await expect(order.getByTestId('order-total')).toHaveText('£95.00');

      // ...and the producer's stock grew by exactly what they promised, already reserved
      await producer.page.getByRole('tab', { name: 'Stock & forecast' }).click();
      const week = producer.page.getByTestId('stock-dyfed-dairy:milk-whole').getByTestId(`week-${mondayOf(FAR)}`);
      await expect(week.getByText('100 reserved')).toBeVisible({ timeout: 10_000 });
      await producer.page.getByRole('tab', { name: /^Demand board/ }).click();
      await expect(producer.page.getByTestId(`decided-${id}`)).toContainText(/You won this: order BL-\d+/);
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('bids are sealed between producers; the buyer compares and the others are told they lost', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    const dairy = await person(browser, producerUrl(s));
    const creamery = await person(browser, producerUrl(s, 'brongest-creamery'));
    try {
      const id = await askFor(buyer.page, { qty: 50, date: FAR });
      await bid(dairy.page, id, 0.95, 50);
      await bid(creamery.page, id, 0.9, 50);
      await expect(creamery.page.getByTestId(`demand-${id}`)).toContainText('2 bid(s) so far'); // the count, not the other price
      await expect(creamery.page.getByTestId(`demand-${id}`)).not.toContainText('0.95');

      const card = buyer.page.getByTestId(`request-${id}`);
      await expect(card.locator('tbody tr')).toHaveCount(2, { timeout: 10_000 });
      await expect(card.locator('tbody tr').first()).toContainText('Brongest Creamery'); // cheapest first
      await card.getByTestId(`bid-${id}-brongest-creamery`).getByRole('button', { name: 'Accept bid' }).click();
      await expect(card.getByTestId(`bid-${id}-dyfed-dairy`)).toContainText('Not chosen');

      await dairy.page.getByRole('tab', { name: /^Demand board/ }).click();
      await expect(dairy.page.getByTestId(`decided-${id}`)).toContainText('Not chosen', { timeout: 10_000 });
      await dairy.page.getByTestId('bell').click();
      await expect(dairy.page.getByTestId('bell-panel')).toContainText('chose another producer');
    } finally {
      await buyer.close();
      await dairy.close();
      await creamery.close();
    }
  });

  test('a producer who sells nothing like it yet can still win, and gains a listing', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    const farm = await person(browser, producerUrl(s, 'preseli-hill-farm')); // no milk today
    try {
      const id = await askFor(buyer.page, { qty: 30, date: FAR });
      await bid(farm.page, id, 1.2, 30);
      await buyer.page.getByTestId(`request-${id}`).getByRole('button', { name: 'Accept bid' }).click();
      await expect(buyer.page.getByTestId(`request-${id}`).getByTestId('request-status')).toHaveText('Filled');
      await farm.page.getByRole('tab', { name: 'My listings' }).click();
      await expect(farm.page.getByTestId('listing-preseli-hill-farm:milk-whole')).toContainText('£1.20');
    } finally {
      await buyer.close();
      await farm.close();
    }
  });

  test('the buyer can withdraw a request; producers see it was withdrawn', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, producerUrl(s));
    try {
      const id = await askFor(buyer.page, { qty: 40, date: FAR });
      await bid(producer.page, id, 0.95, 40);
      buyer.page.once('dialog', (d) => d.accept());
      await buyer.page.getByTestId(`request-${id}`).getByRole('button', { name: 'Withdraw request' }).click();
      await expect(buyer.page.getByTestId(`request-${id}`).getByTestId('request-status')).toHaveText('Withdrawn');
      await expect(producer.page.getByTestId(`decided-${id}`)).toContainText('Request withdrawn', { timeout: 10_000 });
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('if it is already on sale, the form says so and links to Browse', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const form = buyer.page.getByTestId('request-form');
      await form.getByLabel('Product').selectOption({ label: 'Whole milk' });
      await form.getByLabel(/^Quantity/).fill('20');
      await form.getByLabel('Needed on').fill(SOON);
      await expect(buyer.page.getByTestId('already-available')).toContainText(/\d+ producer\(s\) can already supply this/);
      await buyer.page.getByRole('button', { name: 'See them in Browse' }).click();
      await expect(buyer.page.getByRole('tab', { name: 'Browse' })).toHaveAttribute('aria-selected', 'true');
      await expect(buyer.page.getByLabel('Search products')).toHaveValue('Whole milk');
      await expect(buyer.page.getByLabel('Needed on')).toHaveValue(SOON);
    } finally {
      await buyer.close();
    }
  });

  test('requests are validated with a clear message', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const form = buyer.page.getByTestId('request-form');
      await form.getByLabel('Product').selectOption({ label: 'Blue cheese' });
      await form.getByLabel(/^Quantity/).fill('5');
      await form.getByLabel('Needed on').fill(FAR); // a Thursday; cheese is delivered on Wednesdays
      await form.getByRole('button', { name: 'Send request' }).click();
      await expect(form.getByRole('alert')).toContainText('not delivered on that day');
    } finally {
      await buyer.close();
    }
  });
});

test.describe('speculative orders: first to accept', () => {
  test('the buyer sets a price and the first producer to accept gets the order', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { speculative: 'first_accept' });
    const buyer = await person(browser, buyerUrl(s));
    const dairy = await person(browser, producerUrl(s));
    const creamery = await person(browser, producerUrl(s, 'brongest-creamery'));
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      const form = buyer.page.getByTestId('request-form');
      await expect(form.getByLabel(/^Price you would pay/)).toHaveAttribute('required', '');
      const id = await askFor(buyer.page, { qty: 60, target: 0.9, date: FAR });
      await expect(buyer.page.getByTestId(`request-${id}`)).toContainText('Waiting for a producer to accept £0.90');

      await dairy.page.getByRole('tab', { name: /^Demand board/ }).click();
      await creamery.page.getByRole('tab', { name: /^Demand board/ }).click();
      const take = (p: Page) => p.getByTestId(`demand-${id}`).getByRole('button', { name: 'Accept at £0.90 for all 60' });
      await expect(take(dairy.page)).toBeVisible({ timeout: 10_000 });
      await expect(take(creamery.page)).toBeVisible({ timeout: 10_000 });
      await expect(dairy.page.getByTestId(`demand-${id}`).getByRole('button', { name: 'Place bid' })).toHaveCount(0); // no bidding in this model

      await take(dairy.page).click();
      await expect(buyer.page.getByTestId(`request-${id}`).getByTestId('request-status')).toHaveText('Filled', { timeout: 10_000 });
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.locator('[data-testid^="order-BL-"]').first().getByTestId('order-total')).toHaveText('£54.00');
      // The producer who lost sees it vanish from the board and is told it has gone
      await expect(creamery.page.getByTestId(`demand-${id}`)).toHaveCount(0, { timeout: 10_000 });
      await creamery.page.getByTestId('bell').click();
      await expect(creamery.page.getByTestId('bell-panel')).toContainText('request for Whole milk is filled');
    } finally {
      await buyer.close();
      await dairy.close();
      await creamery.close();
    }
  });
});

test.describe('speculative orders: pooled demand', () => {
  test('similar requests are pooled, one producer bid serves them all', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { speculative: 'pooled' });
    const a = await person(browser, buyerUrl(s, 'corner-deli'));
    const b = await person(browser, buyerUrl(s, 'grand-hotel'));
    const producer = await person(browser, producerUrl(s));
    try {
      const ida = await askFor(a.page, { qty: 40, date: FAR });
      const idb = await askFor(b.page, { qty: 60, date: FAR });
      await expect(a.page.getByTestId(`request-${ida}`).getByTestId('pool-note')).toContainText('100 wanted in total by 2 buyers', { timeout: 10_000 });

      await producer.page.getByRole('tab', { name: /^Demand board/ }).click();
      const card = producer.page.getByTestId(`demand-${ida}`);
      await expect(card.getByTestId('pool-note')).toContainText('100 wanted in total by 2 buyers', { timeout: 10_000 });
      await card.getByLabel(/^Your price/).fill('0.93');
      await expect(card.getByLabel(/^How many/)).toHaveValue('100'); // the whole pool by default
      await card.getByRole('button', { name: 'Place bid' }).click();

      await expect(a.page.getByTestId(`bid-${ida}-dyfed-dairy`)).toContainText('40', { timeout: 10_000 });
      await expect(b.page.getByTestId(`bid-${idb}-dyfed-dairy`)).toContainText('60', { timeout: 10_000 });
      await b.page.getByTestId(`request-${idb}`).getByRole('button', { name: 'Accept bid' }).click();
      await expect(b.page.getByTestId(`request-${idb}`).getByTestId('request-status')).toHaveText('Filled');
      await expect(a.page.getByTestId(`request-${ida}`).getByTestId('request-status')).toHaveText('Open'); // each buyer decides alone
    } finally {
      await a.close();
      await b.close();
      await producer.close();
    }
  });
});

test.describe('speculative orders: other models', () => {
  test('the forward-commitment model says standing orders are not built yet', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { market: 'forward' });
    const buyer = await person(browser, buyerUrl(s));
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      await expect(buyer.page.getByText('not built yet')).toBeVisible();
    } finally {
      await buyer.close();
    }
  });

  test('the operator sees requests and bids in the overview', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const r = await request.post('/api/requests', { headers: as(s, 'corner-deli'), data: { productId: 'milk-whole', qty: 80, deliveryDate: FAR } });
    const id = (await r.json()).request.id as string;
    await request.post(`/api/requests/${id}/bids`, { headers: as(s, 'dyfed-dairy'), data: { price: 0.95, qty: 80 } });
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      await op.page.getByRole('tab', { name: 'Orders & metrics' }).click();
      const row = op.page.getByTestId(`overview-${id}`);
      await expect(row).toContainText('Corner Deli');
      await expect(row).toContainText('0/80');
      await expect(row.locator('td').last()).toHaveText('1');
      await expect(op.page.getByTestId('metrics')).toContainText('Open requests');
    } finally {
      await op.close();
    }
  });
});
