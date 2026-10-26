import { expect, test, type Browser } from '@playwright/test';

// Each test uses its own demo session, so tests are isolated and can run in parallel.
let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-${n++}-${Math.random().toString(36).slice(2, 6)}`;
const asBuyer = (s: string) => `/home?s=${s}&as=grand-hotel`;

/** A fresh browser context = another person on their own machine. */
async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}

test('role picker offers buyers, producers and the operator', async ({ page }) => {
  await page.goto(`/?s=${newSession()}`);
  await page.evaluate(() => localStorage.removeItem('persona'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Who are you playing today?' })).toBeVisible();
  for (const name of ['Grand Hotel', 'Dyfed Dairy', 'Bwyd Lleol Bro Teifi']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
});

test('choosing a buyer shows local suppliers with distances', async ({ page }) => {
  await page.goto(`/?s=${newSession()}`);
  await page.evaluate(() => localStorage.removeItem('persona'));
  await page.reload();
  await page.getByRole('button', { name: /Grand Hotel/ }).click();
  await expect(page.getByRole('tab', { name: 'Browse' })).toBeVisible();
  await expect(page.getByText('Playing as: Grand Hotel')).toBeVisible();
  await expect(page.locator('[data-testid^="offer-"]').first()).toBeVisible();
  await expect(page.getByText(/offers? hidden as out of local range/)).toBeVisible();
});

test('direct role link opens that role (shareable links for Zoom role-play)', async ({ page }) => {
  await page.goto(`/home?s=${newSession()}&as=dyfed-dairy`);
  await expect(page.getByRole('tab', { name: 'Stock & forecast' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Whole milk' })).toBeVisible();
});

test('operator switching the model updates the buyer screen live', async ({ browser }) => {
  const s = newSession();
  const buyer = await person(browser, asBuyer(s));
  const op = await person(browser, `/lab?s=${s}&as=operator`);
  try {
    await expect(buyer.page.getByText(/offers? hidden as out of local range/)).toBeVisible();
    await expect(buyer.page.getByText('Beyond local range')).toHaveCount(0);

    await op.page.getByRole('button', { name: 'Warn only' }).click();
    await expect(op.page.getByText('Out-of-range items are shown greyed with a warning.')).toBeVisible();

    // The buyer never reloads: polling picks up the change.
    await expect(buyer.page.getByText('Beyond local range').first()).toBeVisible({ timeout: 10_000 });
    await expect(buyer.page.getByText(/offers? hidden as out of local range/)).toHaveCount(0);
    await expect(buyer.page.getByText(/Model:/)).toContainText('Catalogue marketplace');
  } finally {
    await buyer.close(); await op.close();
  }
});

test('sessions are isolated from one another', async ({ browser }) => {
  const a = newSession(); const b = newSession();
  const opA = await person(browser, `/lab?s=${a}&as=operator`);
  const buyerB = await person(browser, asBuyer(b));
  try {
    await opA.page.getByRole('button', { name: 'Warn only' }).click();
    await expect(opA.page.getByText('Out-of-range items are shown greyed')).toBeVisible();
    await buyerB.page.waitForTimeout(4000); // longer than one poll
    await expect(buyerB.page.getByText('Beyond local range')).toHaveCount(0);
  } finally {
    await opA.close(); await buyerB.close();
  }
});

test('only the operator may change the model', async ({ request }) => {
  const s = newSession();
  const denied = await request.put('/api/config', { headers: { 'x-session': s, 'x-persona': 'grand-hotel' }, data: { market: 'rfq' } });
  expect(denied.status()).toBe(403);
  const ok = await request.put('/api/config', { headers: { 'x-session': s, 'x-persona': 'operator' }, data: { market: 'rfq' } });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).market).toBe('rfq');
});

test('Welsh toggle switches the interface language', async ({ page }) => {
  await page.goto(asBuyer(newSession()));
  await expect(page.getByRole('tab', { name: 'Browse' })).toBeVisible();
  await page.getByRole('button', { name: 'Cymraeg' }).click();
  await expect(page.getByRole('tab', { name: 'Pori' })).toBeVisible();
  await expect(page.getByText('Dyddiad dosbarthu').first()).toBeVisible();
});
