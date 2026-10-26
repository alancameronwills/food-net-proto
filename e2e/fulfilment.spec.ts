import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import { nextWeekday } from '../src/shared/orders';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-f${n++}-${Math.random().toString(36).slice(2, 6)}`;
const MILK = 'dyfed-dairy:milk-whole';
const DELIVERY = nextWeekday(addDays(todayIso(), 3), [4]);
const FORECAST_DAY = nextWeekday(addDays(mondayOf(todayIso()), 14), [4]); // a week seeded as forecast
const buyerUrl = (s: string, as = 'corner-deli') => `/home?s=${s}&as=${as}`;
const producerUrl = (s: string, as = 'dyfed-dairy') => `/home?s=${s}&as=${as}`;

async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}

const as = (s: string, persona: string) => ({ 'x-session': s, 'x-persona': persona });
async function setModel(request: APIRequestContext, s: string, config: Record<string, unknown> = {}) {
  const r = await request.put('/api/config', { headers: as(s, 'operator'), data: { localRange: 'flat', flatRadiusKm: 200, ...config } });
  expect(r.ok()).toBe(true);
}
async function placeOrder(request: APIRequestContext, s: string, buyer: string, qty: number, date = DELIVERY) {
  const r = await request.post('/api/orders', { headers: as(s, buyer), data: { deliveryDate: date, lines: [{ listingId: MILK, qty }] } });
  expect(r.ok()).toBe(true);
  return (await r.json()).orders[0].id as string;
}

test.describe('notifications and the activity feed', () => {
  test('the producer is told about a new order, and can mark it read', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const producer = await person(browser, producerUrl(s));
    try {
      await expect(producer.page.getByTestId('bell-count')).toHaveCount(0);
      const ref = await placeOrder(request, s, 'corner-deli', 10);
      await expect(producer.page.getByTestId('bell-count')).toHaveText('1', { timeout: 10_000 });
      await producer.page.getByTestId('bell').click();
      await expect(producer.page.getByTestId('bell-panel')).toContainText(`Corner Deli placed order ${ref} with Dyfed Dairy`);
      await producer.page.getByRole('button', { name: 'Mark all read' }).click();
      await expect(producer.page.getByTestId('bell-count')).toHaveCount(0);
    } finally {
      await producer.close();
    }
  });

  test('notifications and the feed read in Welsh too', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const producer = await person(browser, producerUrl(s));
    try {
      const ref = await placeOrder(request, s, 'corner-deli', 10);
      await producer.page.getByRole('button', { name: 'Cymraeg' }).click();
      await producer.page.getByTestId('bell').click();
      await expect(producer.page.getByTestId('bell-panel')).toContainText(`Gosododd Corner Deli archeb ${ref} gyda Dyfed Dairy`, { timeout: 10_000 });
    } finally {
      await producer.close();
    }
  });

  test('everyone can follow what is happening across the network', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const watcher = await person(browser, buyerUrl(s, 'grand-hotel')); // an uninvolved audience member
    try {
      const ref = await placeOrder(request, s, 'corner-deli', 10);
      await watcher.page.getByTestId('feed-toggle').click();
      await expect(watcher.page.getByTestId('feed-panel')).toContainText(`Corner Deli placed order ${ref} with Dyfed Dairy`, { timeout: 10_000 });
      await expect(watcher.page.getByTestId('bell-count')).toHaveCount(0); // but it is not a notification for them
    } finally {
      await watcher.close();
    }
  });
});

test.describe('picking and delivery', () => {
  test('picked, then delivered short: the buyer sees what arrived and what it cost', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const ref = await placeOrder(request, s, 'corner-deli', 20);
    const buyer = await person(browser, buyerUrl(s));
    const producer = await person(browser, producerUrl(s));
    try {
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const card = producer.page.getByTestId(`order-${ref}`);
      await card.getByRole('button', { name: 'Mark picked' }).click();
      await expect(card.getByTestId('order-status')).toHaveText('Picked');

      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.getByTestId(`order-${ref}`).getByTestId('order-status')).toHaveText('Picked', { timeout: 10_000 });

      await card.getByRole('button', { name: 'Mark delivered' }).click();
      await card.getByLabel(/^Delivered/).fill('15');
      await card.getByRole('button', { name: 'Record delivery' }).click();
      await expect(card.getByTestId('order-status')).toHaveText('Delivered short');

      const mine = buyer.page.getByTestId(`order-${ref}`);
      await expect(mine.getByTestId('order-status')).toHaveText('Delivered short', { timeout: 10_000 });
      await expect(mine.getByTestId('delivered-qty')).toHaveText('15');
      await expect(mine.getByTestId('order-total')).toHaveText('£14.25'); // 15 x £0.95, not the £19.00 ordered
      await expect(mine.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
      await expect(buyer.page.getByTestId('bell-count')).not.toHaveCount(0);
    } finally {
      await buyer.close();
      await producer.close();
    }
  });

  test('delivered in full leaves the order complete', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const ref = await placeOrder(request, s, 'corner-deli', 10);
    const producer = await person(browser, producerUrl(s));
    try {
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const card = producer.page.getByTestId(`order-${ref}`);
      await card.getByRole('button', { name: 'Mark delivered' }).click();
      await card.getByRole('button', { name: 'Record delivery' }).click();
      await expect(card.getByTestId('order-status')).toHaveText('Delivered');
      await expect(producer.page.getByRole('heading', { name: /Delivered or short/ })).toBeVisible();
    } finally {
      await producer.close();
    }
  });
});

test.describe('trust display follows the model', () => {
  test('reliability score, verified badges, or nothing', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s);
    const buyer = await person(browser, buyerUrl(s));
    try {
      const offer = buyer.page.getByTestId(`offer-${MILK}`);
      await expect(offer.getByTestId('trust')).toContainText(/\d+% delivered in full · 52 orders/);

      await request.put('/api/config', { headers: as(s, 'operator'), data: { trust: 'badges' } });
      await expect(offer.getByTestId('trust')).toHaveText('✓ Verified member', { timeout: 10_000 });

      await request.put('/api/config', { headers: as(s, 'operator'), data: { trust: 'hidden' } });
      await expect(offer.getByTestId('trust')).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await buyer.close();
    }
  });

  test('a poor delivery lowers the score the next buyer sees', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const buyer = await person(browser, buyerUrl(s, 'grand-hotel'));
    try {
      const read = async () => Number(/(\d+)% delivered/.exec((await buyer.page.getByTestId(`offer-${MILK}`).getByTestId('trust').textContent())!)![1]);
      const before = await read();
      for (let i = 0; i < 3; i++) {
        const ref = await placeOrder(request, s, 'corner-deli', 10);
        const r = await request.post(`/api/orders/${ref}/deliver`, { headers: as(s, 'dyfed-dairy'), data: { lines: [{ listingId: MILK, qty: 0 }] } });
        expect(r.ok()).toBe(true);
      }
      await expect.poll(read, { timeout: 15_000 }).toBeLessThan(before);
    } finally {
      await buyer.close();
    }
  });
});

test.describe('supply cuts', () => {
  async function twoOrdersInForecastWeek(request: APIRequestContext, s: string) {
    await setModel(request, s, { stockTrigger: 'on_place', forecastOrdering: 'full_forecast' });
    const start = mondayOf(FORECAST_DAY);
    const r = await request.put('/api/windows', { headers: as(s, 'dyfed-dairy'), data: { listingId: MILK, start, qtyTotal: 100, confidence: 'forecast' } });
    expect(r.ok()).toBe(true);
    const refs = [];
    for (const b of ['corner-deli', 'grand-hotel']) refs.push(await placeOrder(request, s, b, 40, FORECAST_DAY));
    return refs;
  }

  test('the producer is warned, the buyer sees a flag with alternatives, and can keep or switch', async ({ browser, request }) => {
    const s = newSession();
    const [first, second] = await twoOrdersInForecastWeek(request, s);
    const producer = await person(browser, producerUrl(s));
    const buyer = await person(browser, buyerUrl(s, 'grand-hotel'));
    try {
      // Cut the forecast to provisional: 80 units already promised no longer have a firm supply
      const cell = producer.page.getByTestId(`stock-${MILK}`).getByTestId(`week-${mondayOf(FORECAST_DAY)}`);
      await cell.getByRole('combobox').selectOption('provisional');
      await expect(producer.page.getByTestId('cut-warning')).toContainText('2 order(s) no longer fit');

      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      const mine = buyer.page.getByTestId(`order-${second}`);
      const banner = mine.getByTestId('supply-cut-banner');
      await expect(banner).toContainText('may be 40 short', { timeout: 10_000 });
      await expect(banner).toContainText('Also available');

      // Switch: the alternative goes into the basket for the same delivery date
      await banner.locator('[data-testid^="alt-"]').first().click();
      await expect(buyer.page.getByRole('tab', { name: 'Browse' })).toHaveAttribute('aria-selected', 'true');
      await expect(buyer.page.getByTestId('cart')).toContainText('Your basket');
      await expect(buyer.page.getByTestId('cart').locator('[data-testid^="cart-line-"]')).toHaveCount(1);

      // ...or keep the order as it is
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await mine.getByRole('button', { name: 'Keep this order' }).click();
      await expect(mine.getByTestId('supply-cut-banner')).toHaveCount(0);
      await expect(mine.getByTestId('order-status')).toHaveText('Confirmed');

      // The producer's own screen shows which orders are short
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      await expect(producer.page.getByTestId(`order-${first}`).getByTestId('producer-flag')).toContainText('Short by 40 after your cut');
    } finally {
      await producer.close();
      await buyer.close();
    }
  });

  test('restoring the supply clears the flags', async ({ browser, request }) => {
    const s = newSession();
    const [first] = await twoOrdersInForecastWeek(request, s);
    const buyer = await person(browser, buyerUrl(s));
    try {
      const put = (confidence: string) => request.put('/api/windows', { headers: as(s, 'dyfed-dairy'), data: { listingId: MILK, start: mondayOf(FORECAST_DAY), qtyTotal: 100, confidence } });
      await put('provisional');
      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.getByTestId(`order-${first}`).getByTestId('supply-cut-banner')).toBeVisible({ timeout: 10_000 });
      await put('in_stock');
      await expect(buyer.page.getByTestId(`order-${first}`).getByTestId('supply-cut-banner')).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await buyer.close();
    }
  });
});

test.describe('operator overview', () => {
  test('shows metrics and every order', async ({ browser, request }) => {
    const s = newSession();
    await setModel(request, s, { stockTrigger: 'on_place' });
    const a = await placeOrder(request, s, 'corner-deli', 20);
    const b = await placeOrder(request, s, 'grand-hotel', 10);
    await request.post(`/api/orders/${a}/deliver`, { headers: as(s, 'dyfed-dairy'), data: { lines: [{ listingId: MILK, qty: 10 }] } });
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      await op.page.getByRole('tab', { name: 'Orders & metrics' }).click();
      await expect(op.page.getByTestId(`overview-${a}`)).toContainText('Delivered short');
      await expect(op.page.getByTestId(`overview-${b}`)).toContainText('Confirmed');
      const metrics = op.page.getByTestId('metrics');
      await expect(metrics).toContainText('50%'); // 10 of 20 arrived
      await expect(metrics).toContainText('£19.00'); // 10 x 0.95 delivered + 10 x 0.95 confirmed
      await op.page.getByRole('tab', { name: 'Activity' }).click();
      await expect(op.page.getByTestId('activity-list')).toContainText(`delivered order ${a} to Corner Deli short`);
    } finally {
      await op.close();
    }
  });
});
