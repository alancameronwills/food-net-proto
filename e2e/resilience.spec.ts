import { expect, test } from '@playwright/test';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-x${n++}-${Math.random().toString(36).slice(2, 6)}`;

test.describe('when something goes wrong', () => {
  test('a screen that crashes says so and offers a reload, instead of going blank', async ({ page }) => {
    const s = newSession();
    // Simulate bad data: the delivery model is the hub courier but the hub days are missing
    await page.route('**/api/bootstrap', async (route) => {
      try {
        const res = await route.fetch();
        const body = await res.json();
        body.config = { ...body.config, delivery: 'hub_courier', hubDays: undefined };
        await route.fulfill({ response: res, json: body });
      } catch {
        /* the test ended while a poll was in flight */
      }
    });
    await page.goto(`/lab?s=${s}&as=operator`);
    const crash = page.getByTestId('crash');
    await expect(crash).toBeVisible();
    await expect(crash).toContainText('This screen hit a problem');
    await expect(crash.getByRole('button', { name: 'Reload' })).toBeVisible();
    // The header is still there, so people can switch role or language
    await expect(page.getByRole('link', { name: /Bwyd Bro'r Garreg Las/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cymraeg' }).click();
    await expect(crash).toContainText('Cafodd y sgrin hon broblem');
  });

  test('switching to the hub courier works on a fresh session and shows the hub days', async ({ page }) => {
    const s = newSession();
    await page.goto(`/lab?s=${s}&as=operator`);
    await page.getByRole('button', { name: 'Hub courier' }).first().click();
    await expect(page.getByTestId('hub-days')).toBeVisible();
    await expect(page.getByTestId('crash')).toHaveCount(0);
    await page.getByRole('button', { name: 'Area delivery days' }).click();
    await expect(page.getByTestId('hub-days')).toHaveCount(0);
  });
});

test('a model switch that fails to save says so', async ({ page }) => {
  const s = newSession();
  await page.goto(`/lab?s=${s}&as=operator`);
  await expect(page.getByTestId('presets')).toBeVisible();
  await page.route('**/api/config', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { error: 'The database is busy' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Hub courier' }).first().click();
  await expect(page.getByTestId('lab-error')).toContainText('The database is busy');
  await page.unroute('**/api/config');
  await page.getByRole('button', { name: 'Hub courier' }).first().click();
  await expect(page.getByTestId('lab-error')).toHaveCount(0);
  await expect(page.getByTestId('hub-days')).toBeVisible();
});

test('two quick hub-day clicks both stick, even when the screen is slow to refresh', async ({ page, request }) => {
  const s = newSession();
  const headers = { 'x-session': s, 'x-persona': 'operator' };
  await request.put('/api/config', { headers, data: { delivery: 'hub_courier', hubDays: [2, 4, 6] } });
  // Make the screen's copy of the settings slow to catch up, which is when a second click used to build on stale data
  await page.route('**/api/bootstrap', async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    try { await route.continue(); } catch { /* test over */ }
  });
  await page.goto(`/lab?s=${s}&as=operator`);
  const days = page.getByTestId('hub-days');
  await expect(days).toBeVisible({ timeout: 20_000 });
  const saved = page.waitForResponse((r) => r.url().includes('/api/config') && r.request().method() === 'PUT');
  await days.getByRole('button', { name: 'Thu' }).click();
  await saved; // the first change is saved, but the screen has not yet refreshed
  await days.getByRole('button', { name: 'Sat' }).click();
  await expect.poll(async () => ((await (await request.get('/api/config', { headers })).json()) as { hubDays: number[] }).hubDays, { timeout: 20_000 }).toEqual([2]);
  await expect(days.getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
  await expect(days.getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'false');
  await expect(days.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'false');
});
