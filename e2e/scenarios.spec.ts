import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-s${n++}-${Math.random().toString(36).slice(2, 6)}`;
const as = (s: string, persona: string) => ({ 'x-session': s, 'x-persona': persona });
const MILK = 'dyfed-dairy:milk-whole';
const THURSDAY = addDays(mondayOf(todayIso()), 10);

async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}
/** The checklist is a slim bar; open the full list of steps. */
async function openSteps(page: import('@playwright/test').Page) {
  if (!(await page.getByTestId('scenario-step-0').isVisible())) await page.getByTestId('scenario-expand').click();
}
const startScenario = (request: APIRequestContext, s: string, id: string) =>
  request.post('/api/admin/scenario', { headers: as(s, 'operator'), data: { id } });

test.describe('guided scenarios', () => {
  test('the operator starts one from the launcher, and everyone sees the checklist', async ({ browser }) => {
    const s = newSession();
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await expect(buyer.page.getByTestId('scenario-panel')).toHaveCount(0);
      await op.page.getByRole('tab', { name: 'Scenarios' }).click();
      await expect(op.page.getByTestId('scenario-standing-order')).toContainText('not built yet');
      await expect(op.page.getByTestId('scenario-standing-order').getByRole('button', { name: 'Start' })).toHaveCount(0);

      op.page.once('dialog', (d) => d.accept());
      await op.page.getByTestId('scenario-stock-down').getByRole('button', { name: 'Start' }).click();
      await expect(op.page.getByText('Scenario started')).toBeVisible();
      await expect(op.page.getByTestId('scenario-panel')).toContainText('Watch the stock go down');

      const panel = buyer.page.getByTestId('scenario-panel');
      await expect(panel).toBeVisible({ timeout: 10_000 });
      await expect(panel.getByTestId('scenario-progress')).toHaveText('0 of 4 done');
      await expect(panel.getByTestId('scenario-current')).toContainText('note how much whole milk can be ordered');
      await openSteps(buyer.page);
      await expect(panel.locator('[data-testid^="scenario-step-"]')).toHaveCount(4);
    } finally {
      await op.close();
      await buyer.close();
    }
  });

  test('steps tick themselves as people do things, and manual steps can be ticked by hand', async ({ browser, request }) => {
    const s = newSession();
    expect((await startScenario(request, s, 'stock-down')).ok()).toBe(true);
    await request.put('/api/config', { headers: as(s, 'operator'), data: { localRange: 'flat', flatRadiusKm: 200 } });
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      const panel = producer.page.getByTestId('scenario-panel');
      await openSteps(producer.page);
      await expect(panel.getByTestId('scenario-step-1')).toHaveAttribute('data-done', 'false');

      // Step 1 is manual
      await panel.getByTestId('scenario-step-0').getByRole('button', { name: 'Mark done' }).click();
      await expect(panel.getByTestId('scenario-step-0')).toHaveAttribute('data-done', 'true');
      await producer.page.reload();
      await openSteps(producer.page);
      await expect(producer.page.getByTestId('scenario-step-0')).toHaveAttribute('data-done', 'true'); // remembered

      // Steps 2 and 3 follow the real activity
      const placed = await request.post('/api/orders', { headers: as(s, 'corner-deli'), data: { deliveryDate: THURSDAY, lines: [{ listingId: MILK, qty: 20 }] } });
      const ref = (await placed.json()).orders[0].id as string;
      await expect(producer.page.getByTestId('scenario-step-1')).toHaveAttribute('data-done', 'true', { timeout: 10_000 });
      await expect(producer.page.getByTestId('scenario-step-2')).toHaveAttribute('data-done', 'false');
      await request.post(`/api/orders/${ref}/confirm`, { headers: as(s, 'dyfed-dairy') });
      await expect(producer.page.getByTestId('scenario-step-2')).toHaveAttribute('data-done', 'true', { timeout: 10_000 });
      await expect(producer.page.getByTestId('scenario-progress')).toHaveText('3 of 4 done');
    } finally {
      await producer.close();
    }
  });

  test('"Play as" switches to the role a step needs', async ({ browser, request }) => {
    const s = newSession();
    await startScenario(request, s, 'stock-down');
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await openSteps(buyer.page);
      const step = buyer.page.getByTestId('scenario-step-1');
      await expect(step).toContainText('You are playing this');
      await buyer.page.getByTestId('scenario-step-0').getByRole('button', { name: 'Play as Dyfed Dairy' }).click();
      await expect(buyer.page.getByText('Playing as: Dyfed Dairy')).toBeVisible();
      await expect(buyer.page.getByTestId('scenario-panel')).toBeVisible();
    } finally {
      await buyer.close();
    }
  });

  test('forecast-cut: the orders are waiting, and the cut warns the buyers', async ({ browser, request }) => {
    const s = newSession();
    expect((await startScenario(request, s, 'forecast-cut')).ok()).toBe(true);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    const buyer = await person(browser, `/home?s=${s}&as=castle-caterers`);
    try {
      const week = mondayOf(addDays(mondayOf(todayIso()), 14));
      const cell = producer.page.getByTestId('stock-dyfed-dairy:milk-whole').getByTestId(`week-${week}`);
      await expect(cell.getByText('80 reserved')).toBeVisible(); // two buyers have 40 each
      await openSteps(producer.page);
      await cell.getByRole('combobox').selectOption('provisional');
      await expect(producer.page.getByTestId('cut-warning')).toContainText('2 order(s)');
      await expect(producer.page.getByTestId('scenario-step-0')).toHaveAttribute('data-done', 'true', { timeout: 10_000 });

      await buyer.page.getByRole('tab', { name: /My orders/ }).click();
      await expect(buyer.page.getByTestId('supply-cut-banner')).toContainText('may be 40 short', { timeout: 10_000 });
    } finally {
      await producer.close();
      await buyer.close();
    }
  });

  test('short-delivery: the order is already waiting for the producer', async ({ browser, request }) => {
    const s = newSession();
    expect((await startScenario(request, s, 'short-delivery')).ok()).toBe(true);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await producer.page.getByRole('tab', { name: /^Orders/ }).click();
      const card = producer.page.locator('[data-testid^="order-BL-"]').first();
      await card.getByRole('button', { name: 'Mark delivered' }).click();
      await card.getByLabel(/^Delivered/).fill('25');
      await card.getByRole('button', { name: 'Record delivery' }).click();
      await expect(card.getByTestId('order-status')).toHaveText('Delivered short');
      await openSteps(producer.page);
      await expect(producer.page.getByTestId('scenario-step-0')).toHaveAttribute('data-done', 'true', { timeout: 10_000 });
    } finally {
      await producer.close();
    }
  });

  test('starting a scenario resets what was there; ending it removes the checklist for everyone', async ({ browser, request }) => {
    const s = newSession();
    await request.put('/api/config', { headers: as(s, 'operator'), data: { localRange: 'flat', flatRadiusKm: 200 } });
    await request.post('/api/orders', { headers: as(s, 'corner-deli'), data: { deliveryDate: THURSDAY, lines: [{ listingId: MILK, qty: 10 }] } });
    await startScenario(request, s, 'speculative');
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await op.page.getByRole('tab', { name: 'Orders & metrics' }).click();
      await expect(op.page.getByText('No orders yet.')).toBeVisible();
      await expect(buyer.page.getByTestId('scenario-panel')).toBeVisible();
      await openSteps(op.page);
      await op.page.getByTestId('end-scenario').click();
      await expect(buyer.page.getByTestId('scenario-panel')).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await op.close();
      await buyer.close();
    }
  });

  test('the checklist can be hidden and shown, and reads in Welsh', async ({ browser, request }) => {
    const s = newSession();
    await startScenario(request, s, 'plan-menu');
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await buyer.page.getByTestId('scenario-panel').getByRole('button', { name: 'Hide' }).click();
      await expect(buyer.page.getByTestId('scenario-panel')).toHaveCount(0);
      await expect(buyer.page.getByTestId('scenario-tab')).toContainText('Plan next week’s menu (0/3)');
      await buyer.page.getByTestId('scenario-tab').click();
      await buyer.page.getByRole('button', { name: 'Cymraeg' }).click();
      await expect(buyer.page.getByTestId('scenario-panel')).toContainText('Cynllunio bwydlen yr wythnos nesaf');
    } finally {
      await buyer.close();
    }
  });
});

test.describe('feedback box', () => {
  test('comments are saved with the screen and the model, and the operator can read and export them', async ({ browser, request }) => {
    const s = newSession();
    await request.put('/api/config', { headers: as(s, 'operator'), data: { delivery: 'hub_courier', operator: 'hub' } });
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      await buyer.page.getByRole('tab', { name: 'Menu planner' }).click();
      await buyer.page.getByTestId('feedback-open').click();
      await buyer.page.getByLabel('Comment').fill('I would want to see prices per week here');
      await buyer.page.getByRole('button', { name: 'Not good' }).click();
      await buyer.page.getByRole('button', { name: 'Send' }).click();
      await expect(buyer.page.getByText('Thank you, that has been saved.')).toBeVisible();

      await op.page.getByRole('tab', { name: 'Feedback' }).click();
      const item = op.page.getByTestId('feedback-item').first();
      await expect(item).toContainText('Corner Deli', { timeout: 10_000 });
      await expect(item).toContainText('buyer/planner');
      await expect(item).toContainText('I would want to see prices per week here');
      await expect(item.getByTestId('feedback-model')).toContainText('Delivery: Hub courier');
      await expect(item.getByTestId('feedback-model')).toContainText('Operator role: Food hub');

      const [download] = await Promise.all([op.page.waitForEvent('download'), op.page.getByRole('button', { name: 'Download CSV' }).click()]);
      const path = await download.path();
      const csv = (await import('node:fs')).readFileSync(path!, 'utf8');
      expect(csv).toContain('"I would want to see prices per week here"');
      expect(csv.split('\n')[0]).toContain('"time","who","role","screen","mood","scenario","comment"');
      expect(csv).toContain('"Corner Deli","buyer","buyer/planner","down"');

      op.page.once('dialog', (d) => d.accept());
      await op.page.getByRole('button', { name: 'Clear all' }).click();
      await expect(op.page.getByText('No feedback yet.')).toBeVisible();
    } finally {
      await buyer.close();
      await op.close();
    }
  });

  test('feedback given during a scenario says which scenario, and an empty comment is not sent', async ({ browser, request }) => {
    const s = newSession();
    await startScenario(request, s, 'stock-down');
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      await producer.page.getByTestId('feedback-open').click();
      await producer.page.getByRole('button', { name: 'Send' }).click(); // empty: the browser blocks it
      await expect(producer.page.getByTestId('feedback-form')).toBeVisible();
      await producer.page.getByLabel('Comment').fill('Clear enough');
      await producer.page.getByRole('button', { name: 'Send' }).click();
      await expect(producer.page.getByText('Thank you')).toBeVisible();
      await op.page.getByRole('tab', { name: 'Feedback' }).click();
      await expect(op.page.getByTestId('feedback-item').first()).toContainText('Scenario: stock-down', { timeout: 10_000 });
    } finally {
      await producer.close();
      await op.close();
    }
  });
});

test.describe('model lab presets', () => {
  test('a preset sets several switches at once, and everyone sees the new model', async ({ browser }) => {
    const s = newSession();
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await expect(buyer.page.getByText(/Model: Catalogue marketplace · Pure platform · Producer delivers/)).toBeVisible();
      await op.page.getByTestId('preset-hub').click();
      await expect(buyer.page.getByText(/Model: Catalogue marketplace · Food hub · Hub courier/)).toBeVisible({ timeout: 10_000 });
      await op.page.getByTestId('preset-demand-led').click();
      await expect(buyer.page.getByText(/Model: Demand-led \(RFQ\) · Pure platform · Area delivery days/)).toBeVisible({ timeout: 10_000 });
      await op.page.getByTestId('preset-marketplace').click();
      await expect(buyer.page.getByText(/Model: Catalogue marketplace · Pure platform · Producer delivers/)).toBeVisible({ timeout: 10_000 });
    } finally {
      await op.close();
      await buyer.close();
    }
  });
});
