import { expect, test } from '@playwright/test';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-x${n++}-${Math.random().toString(36).slice(2, 6)}`;

test.describe('when something goes wrong', () => {
  test('a screen that crashes says so and offers a reload, instead of going blank', async ({ page }) => {
    const s = newSession();
    // Simulate bad data: the delivery model is the hub courier but the hub days are missing
    await page.route('**/api/bootstrap', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.config = { ...body.config, delivery: 'hub_courier', hubDays: undefined };
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(`/lab?s=${s}&as=operator`);
    const crash = page.getByTestId('crash');
    await expect(crash).toBeVisible();
    await expect(crash).toContainText('This screen hit a problem');
    await expect(crash.getByRole('button', { name: 'Reload' })).toBeVisible();
    // The header is still there, so people can switch role or language
    await expect(page.getByRole('link', { name: /Bwyd Lleol Bro Teifi/ })).toBeVisible();
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
