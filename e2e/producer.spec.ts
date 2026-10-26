import { expect, test, type Browser } from '@playwright/test';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-p${n++}-${Math.random().toString(36).slice(2, 6)}`;
const MONDAY = mondayOf(todayIso());
const producerUrl = (s: string, as = 'dyfed-dairy') => `/home?s=${s}&as=${as}`;
const MILK = 'stock-dyfed-dairy:milk-whole';

async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}

test.describe('producer: stock & forecast editor', () => {
  test('shows weekly supply with confidence and what buyers can order', async ({ page }) => {
    await page.goto(producerUrl(newSession()));
    const card = page.getByTestId(MILK);
    await expect(card.getByRole('heading', { name: 'Whole milk' })).toBeVisible();
    const thisWeek = card.getByTestId(`week-${MONDAY}`);
    await expect(thisWeek.getByRole('combobox')).toHaveValue('in_stock');
    await expect(thisWeek.getByText(/Buyers can order/)).toBeVisible();
    // A week with no supply planned yet offers an add button
    await expect(card.getByRole('button', { name: '+ Add' }).first()).toBeVisible();
  });

  test('editing a quantity saves and persists across reload', async ({ page }) => {
    await page.goto(producerUrl(newSession()));
    const cell = page.getByTestId(MILK).getByTestId(`week-${MONDAY}`);
    const qty = cell.getByRole('spinbutton');
    await qty.fill('321');
    await qty.press('Enter');
    await expect(cell.getByText('Buyers can order: 321')).toBeVisible(); // in stock: all of it
    await page.reload();
    await expect(page.getByTestId(MILK).getByTestId(`week-${MONDAY}`).getByRole('spinbutton')).toHaveValue('321');
  });

  test('changing confidence to provisional means buyers cannot order it yet', async ({ page }) => {
    await page.goto(producerUrl(newSession()));
    const cell = page.getByTestId(MILK).getByTestId(`week-${MONDAY}`);
    await cell.getByRole('combobox').selectOption('provisional');
    await expect(cell.getByText('Buyers can order: 0')).toBeVisible();
  });

  test('a week can be added and removed', async ({ page }) => {
    await page.goto(producerUrl(newSession()));
    const far = addDays(MONDAY, 7 * 8);
    const card = page.getByTestId(MILK);
    await expect(card.getByTestId(`week-${far}`)).toHaveCount(0);
    await expect(card.getByTestId(`week-${MONDAY}`)).toBeVisible();
    const before = await card.locator('[data-testid^="week-"]').count();
    await card.getByRole('button', { name: '+ Add' }).first().click();
    await expect(card.locator('[data-testid^="week-"]')).toHaveCount(before + 1);
    page.once('dialog', (d) => d.accept());
    await card.locator('[data-testid^="week-"]').last().getByRole('button', { name: 'Remove' }).click();
    await expect(card.locator('[data-testid^="week-"]')).toHaveCount(before);
  });

  test('the forecast quantity buyers can order follows the operator model, live', async ({ browser }) => {
    const s = newSession();
    const producer = await person(browser, producerUrl(s));
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      const forecastWeek = producer.page.getByTestId(MILK).locator('[data-testid^="week-"]').nth(2); // seeded as forecast
      await expect(forecastWeek.getByRole('combobox')).toHaveValue('forecast');
      const qty = Number(await forecastWeek.getByRole('spinbutton').inputValue());
      await expect(forecastWeek.getByText(`Buyers can order: ${Math.floor(qty * 0.7)}`)).toBeVisible(); // default: 70% of forecast

      await op.page.getByRole('button', { name: 'In stock only' }).click();
      await expect(forecastWeek.getByText('Buyers can order: 0')).toBeVisible({ timeout: 10_000 });
      await op.page.getByRole('button', { name: 'Fully orderable' }).click();
      await expect(forecastWeek.getByText(`Buyers can order: ${qty}`)).toBeVisible({ timeout: 10_000 });
    } finally {
      await producer.close();
      await op.close();
    }
  });
});

test.describe('producer: listings', () => {
  test('adding a product makes it appear for buyers, removing it makes it vanish', async ({ browser }) => {
    const s = newSession();
    const producer = await person(browser, producerUrl(s));
    const buyer = await person(browser, `/home?s=${s}&as=harbour-bistro`);
    try {
      const dyfedLamb = buyer.page.getByTestId('offer-dyfed-dairy:meat-lamb');
      await expect(buyer.page.getByRole('tab', { name: 'Browse' })).toBeVisible();
      await buyer.page.getByLabel('Only what I can order').uncheck(); // a brand-new listing has no supply yet
      await expect(dyfedLamb).toHaveCount(0);

      await producer.page.getByRole('tab', { name: 'My listings' }).click();
      await producer.page.getByRole('button', { name: 'Add a product to sell' }).click();
      await producer.page.getByLabel('Product').selectOption({ label: 'Salt-marsh lamb shoulder' });
      await producer.page.getByLabel(/Price per unit/).fill('17.25');
      await producer.page.getByLabel(/Minimum order/).fill('3');
      await producer.page.getByRole('button', { name: 'Save' }).click();
      await expect(producer.page.getByTestId('listing-dyfed-dairy:meat-lamb')).toContainText('£17.25');

      await expect(dyfedLamb).toHaveCount(1, { timeout: 10_000 }); // the buyer never reloaded

      producer.page.once('dialog', (d) => d.accept());
      await producer.page.getByTestId('listing-dyfed-dairy:meat-lamb').getByRole('button', { name: 'Remove' }).click();
      await expect(dyfedLamb).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await producer.close();
      await buyer.close();
    }
  });

  test('editing the price updates what buyers see', async ({ browser }) => {
    const s = newSession();
    const producer = await person(browser, producerUrl(s));
    const buyer = await person(browser, `/home?s=${s}&as=harbour-bistro`);
    try {
      await buyer.page.getByLabel('Only what I can order').uncheck();
      await producer.page.getByRole('tab', { name: 'My listings' }).click();
      const row = producer.page.getByTestId('listing-dyfed-dairy:cheese-cheddar');
      await row.getByRole('button', { name: 'Edit' }).click();
      await producer.page.getByLabel(/Price per unit/).fill('14.80');
      await producer.page.getByRole('button', { name: 'Save' }).click();
      await expect(row).toContainText('£14.80');
      await expect(buyer.page.getByTestId('offer-dyfed-dairy:cheese-cheddar')).toContainText('£14.80', { timeout: 10_000 });
    } finally {
      await producer.close();
      await buyer.close();
    }
  });

  test('volume price breaks are offered only under the volume-tiers pricing model', async ({ browser }) => {
    const s = newSession();
    const producer = await person(browser, producerUrl(s));
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    try {
      await producer.page.getByRole('tab', { name: 'My listings' }).click();
      const row = producer.page.getByTestId('listing-dyfed-dairy:milk-whole');
      await row.getByRole('button', { name: 'Edit' }).click();
      await expect(producer.page.getByText('Volume prices')).toHaveCount(0);
      await producer.page.getByRole('button', { name: 'Cancel' }).click();

      await op.page.getByRole('button', { name: 'Volume tiers' }).click();
      await expect(op.page.getByText('Bigger orders earn a lower unit price.')).toBeVisible();
      await producer.page.reload(); // pick up the new model straight away rather than waiting for a poll
      await producer.page.getByRole('tab', { name: 'My listings' }).click();
      await row.getByRole('button', { name: 'Edit' }).click();
      await expect(producer.page.getByText('Volume prices')).toBeVisible();
      await producer.page.getByRole('button', { name: '+ Add a price break' }).click();
      await producer.page.getByLabel('From quantity').fill('50');
      await producer.page.getByLabel('Price (£)').fill('0.80');
      await producer.page.getByRole('button', { name: 'Save' }).click();
      await expect(row).toContainText('50+ £0.80');
    } finally {
      await producer.close();
      await op.close();
    }
  });

  test('the server rejects a price break that is not cheaper, and the message is shown', async ({ browser }) => {
    const s = newSession();
    const op = await person(browser, `/lab?s=${s}&as=operator`);
    const producer = await person(browser, producerUrl(s));
    try {
      await op.page.getByRole('button', { name: 'Volume tiers' }).click();
      await expect(op.page.getByText('Bigger orders earn a lower unit price.')).toBeVisible();
      await producer.page.reload();
      await producer.page.getByRole('tab', { name: 'My listings' }).click();
      const row = producer.page.getByTestId('listing-dyfed-dairy:milk-whole');
      await row.getByRole('button', { name: 'Edit' }).click();
      await expect(producer.page.getByText('Volume prices')).toBeVisible();
      await producer.page.getByRole('button', { name: '+ Add a price break' }).click();
      await producer.page.getByLabel('From quantity').fill('50');
      await producer.page.getByLabel('Price (£)').fill('5'); // dearer than the £0.95 base price
      await producer.page.getByRole('button', { name: 'Save' }).click();
      await expect(producer.page.getByRole('alert')).toContainText('lower price');
    } finally {
      await producer.close();
      await op.close();
    }
  });
});
