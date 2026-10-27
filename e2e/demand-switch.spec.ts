import { expect, test, type Browser } from '@playwright/test';

let n = 0;
const newSession = () => `pw-${Date.now().toString(36)}-n${n++}-${Math.random().toString(36).slice(2, 6)}`;
const slow = { timeout: 30_000 };

async function person(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}
const labUrl = (s: string) => `/lab?s=${s}&as=operator`;

test.describe('the demand requests switch in the Model Lab', () => {
  test('it is on to begin with, and switching it off removes the demand screens from every role, live', async ({ browser }) => {
    const s = newSession();
    const op = await person(browser, labUrl(s));
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      const toggle = op.page.getByTestId('demand-toggle');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(buyer.page.getByRole('tab', { name: /^Ask for something/ })).toBeVisible();
      await expect(producer.page.getByRole('tab', { name: /^Demand board/ })).toBeVisible();

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(buyer.page.getByRole('tab', { name: /^Ask for something/ })).toHaveCount(0, slow);
      await expect(producer.page.getByRole('tab', { name: /^Demand board/ })).toHaveCount(0, slow);
      // the rest of each screen is untouched
      await expect(buyer.page.getByRole('tab', { name: 'Browse' })).toBeVisible();
      await expect(buyer.page.getByRole('tab', { name: /My orders/ })).toBeVisible();
      await expect(producer.page.getByRole('tab', { name: 'Stock & forecast' })).toBeVisible();
      await expect(producer.page.getByRole('tab', { name: /^Orders/ })).toBeVisible();

      // the operator's own overview loses the requests tile too
      await op.page.getByRole('tab', { name: 'Orders & metrics' }).click();
      await expect(op.page.getByTestId('metrics')).not.toContainText('Open requests');
      await expect(op.page.getByTestId('metrics')).toContainText('Orders');

      await op.page.getByRole('tab', { name: 'Model Lab' }).click();
      await op.page.getByTestId('demand-toggle').click();
      await expect(buyer.page.getByRole('tab', { name: /^Ask for something/ })).toBeVisible(slow);
      await expect(producer.page.getByRole('tab', { name: /^Demand board/ })).toBeVisible(slow);
      await op.page.getByRole('tab', { name: 'Orders & metrics' }).click();
      await expect(op.page.getByTestId('metrics')).toContainText('Open requests');
    } finally {
      await op.close();
      await buyer.close();
      await producer.close();
    }
  });

  test('someone on the demand screen when it goes off is taken back to the main screen, not left on a blank page', async ({ browser }) => {
    const s = newSession();
    const op = await person(browser, labUrl(s));
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    const producer = await person(browser, `/home?s=${s}&as=dyfed-dairy`);
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      await expect(buyer.page.getByTestId('request-form')).toBeVisible();
      await producer.page.getByRole('tab', { name: /^Demand board/ }).click();
      await expect(producer.page.getByText(/What local buyers are asking for/)).toBeVisible();

      await op.page.getByTestId('demand-toggle').click();
      await expect(buyer.page.getByTestId('request-form')).toHaveCount(0, slow);
      await expect(buyer.page.getByRole('tab', { name: 'Browse' })).toHaveAttribute('aria-selected', 'true');
      await expect(buyer.page.getByTestId('delivery-long')).toBeVisible();
      await expect(producer.page.getByText(/What local buyers are asking for/)).toHaveCount(0, slow);
      await expect(producer.page.getByRole('tab', { name: 'Stock & forecast' })).toHaveAttribute('aria-selected', 'true');
      await expect(producer.page.getByTestId('crash')).toHaveCount(0);
    } finally {
      await op.close();
      await buyer.close();
      await producer.close();
    }
  });

  test('requests already made are hidden while it is off, and come back with their bids when it is on again', async ({ browser, request }) => {
    const s = newSession();
    const h = (persona: string) => ({ 'x-session': s, 'x-persona': persona });
    await request.put('/api/config', { headers: h('operator'), data: { localRange: 'flat', flatRadiusKm: 200 } });
    const date = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 24); while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const made = await request.post('/api/requests', { headers: h('corner-deli'), data: { productId: 'veg-tomato', qty: 40, deliveryDate: date } });
    const id = (await made.json()).request.id as string;
    await request.post(`/api/requests/${id}/bids`, { headers: h('brynberian-garden'), data: { price: 6.5, qty: 40 } });

    const op = await person(browser, labUrl(s));
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      await expect(buyer.page.getByTestId(`request-${id}`)).toBeVisible();
      await op.page.getByTestId('demand-toggle').click();
      await expect(buyer.page.getByRole('tab', { name: /^Ask for something/ })).toHaveCount(0, slow);
      await op.page.getByTestId('demand-toggle').click();
      await buyer.page.getByRole('tab', { name: /^Ask for something/ }).click();
      await expect(buyer.page.getByTestId(`request-${id}`)).toBeVisible(slow);
      await expect(buyer.page.getByTestId(`bid-${id}-brynberian-garden`)).toContainText('£6.50');
    } finally {
      await op.close();
      await buyer.close();
    }
  });

  test('presets keep your choice, except the demand-led one, which is about demand', async ({ browser }) => {
    const s = newSession();
    const op = await person(browser, labUrl(s));
    try {
      const toggle = op.page.getByTestId('demand-toggle');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await op.page.getByTestId('preset-hub').click();
      await expect(op.page.getByText('The network consolidates orders: one invoice, one delivery.')).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false', slow);
      await op.page.getByTestId('preset-marketplace').click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false', slow);
      await op.page.getByTestId('preset-demand-led').click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true', slow);
    } finally {
      await op.close();
    }
  });
});

test.describe('scenarios and the demand switch', () => {
  test('a scenario about demand switches it back on; the others leave it off', async ({ browser }) => {
    test.slow(); // starting a scenario resets a whole session
    const s = newSession();
    const op = await person(browser, labUrl(s));
    const buyer = await person(browser, `/home?s=${s}&as=corner-deli`);
    try {
      await op.page.getByTestId('demand-toggle').click();
      await expect(buyer.page.getByRole('tab', { name: /^Ask for something/ })).toHaveCount(0, slow);

      await op.page.getByRole('tab', { name: 'Scenarios' }).click();
      await expect(op.page.getByTestId('scenario-speculative').getByTestId('uses-demand')).toContainText('switches them on');
      await expect(op.page.getByTestId('scenario-stock-down').getByTestId('uses-demand')).toHaveCount(0);

      // A scenario that has nothing to do with demand: it stays off
      op.page.once('dialog', (d) => d.accept());
      await op.page.getByTestId('scenario-stock-down').getByRole('button', { name: 'Start' }).click();
      await expect(op.page.getByText('Scenario started')).toBeVisible(slow);
      await op.page.getByRole('tab', { name: 'Model Lab' }).click();
      await expect(op.page.getByTestId('demand-toggle')).toHaveAttribute('aria-checked', 'false');
      await expect(buyer.page.getByRole('tab', { name: /^Ask for something/ })).toHaveCount(0);

      // The speculative-order scenario needs it, so it comes back on, for everyone
      await op.page.getByRole('tab', { name: 'Scenarios' }).click();
      op.page.once('dialog', (d) => d.accept());
      await op.page.getByTestId('scenario-speculative').getByRole('button', { name: 'Start' }).click();
      await expect(op.page.getByTestId('scenario-panel')).toContainText('Ask for something not yet available', slow);
      await op.page.getByRole('tab', { name: 'Model Lab' }).click();
      await expect(op.page.getByTestId('demand-toggle')).toHaveAttribute('aria-checked', 'true', slow);
      await expect(buyer.page.getByRole('tab', { name: /^Ask for something/ })).toBeVisible(slow);
    } finally {
      await op.close();
      await buyer.close();
    }
  });
});
