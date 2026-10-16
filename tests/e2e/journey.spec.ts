import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import type { Session } from '../../src/types';

const fixture = resolve('data/campus/visual/png/SE12-F1-p1/overview.png');

test('starts with photo controls, with no library, plan images or promotional heading', async ({
  page,
}) => {
  const errors: string[] = [];
  const planImages: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/data/campus/visual/')) planImages.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByTestId('provider-status')).toHaveText('Setup required');
  await expect(page.getByRole('button', { name: 'Find my location', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Location result', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /library|browse.*plans|explore.*plans|demo|landmark|closure|route|checkpoint/i,
    }),
  ).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(
    /YOUR CAMPUS COMPANION|Your next step, made simple|Let the photo tell the story|Cedar|Maple/,
  );
  expect(planImages).toEqual([]);
  expect(errors).toEqual([]);
});

test('clears a saved Demo preference and uses Gemini readiness without a mode action', async ({
  page,
}) => {
  const modeRequests: unknown[] = [];
  await page.addInitScript(() => localStorage.setItem('campuslens.ai-mode', 'demo'));
  page.on('request', (request) => {
    if (request.url().endsWith('/actions')) modeRequests.push(request.postDataJSON());
  });
  await page.route('**/api/bootstrap', async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, liveAvailable: true } });
  });
  await page.goto('/');
  await expect(page.getByTestId('provider-status')).toHaveText('Gemini ready');
  expect(await page.evaluate(() => localStorage.getItem('campuslens.ai-mode'))).toBeNull();
  await page.reload();
  await expect(page.getByTestId('provider-status')).toHaveText('Gemini ready');
  expect(modeRequests).toEqual([]);
  await expect(page.getByRole('button', { name: /Demo|Enable Live AI|Live AI/i })).toHaveCount(0);
});

test('prepares an image locally but disables analysis and sending when the key is unavailable', async ({
  page,
}) => {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/photo')) sent.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Find my location', exact: true }).click();
  await page.getByLabel('Upload campus photo', { exact: true }).setInputFiles(fixture);
  await expect(page.getByText(/Photo ready\. Choose Analyze/)).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText(/unavailable until Gemini is configured/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Analyze photo against BCIT plans', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: /Send this photo to Google Gemini/ }),
  ).toBeDisabled();
  expect(sent).toEqual([]);
});

test('mobile photo capture uses the native picker and keeps upload available', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Find my location', exact: true }).click();
  await expect(page.getByLabel('Capture phone photo')).toHaveAttribute('capture', 'environment');
  await expect(page.getByRole('button', { name: /checkpoint|landmark/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload photo', exact: true })).toBeEnabled();
});

for (const failure of [
  {
    status: 503,
    code: 'unavailable',
    message: 'Gemini is temporarily unavailable. Try again shortly.',
  },
  {
    status: 429,
    code: 'quota',
    message: 'Gemini quota exhausted. Wait for the provider limit to reset.',
  },
  {
    status: 502,
    code: 'response_limit',
    message: 'Gemini reached its response limit before finishing. Try a more specific request.',
  },
]) {
  test(`shows ${failure.code} without restoring Demo or producing a location (mocked provider)`, async ({
    page,
  }) => {
    let current!: Session;
    await page.route('**/api/bootstrap', async (route) => {
      const data = await (await route.fetch()).json();
      await route.fulfill({ json: { ...data, liveAvailable: true } });
    });
    await page.route('**/api/sessions', async (route) => {
      current = await (await route.fetch()).json();
      await route.fulfill({ json: current });
    });
    await page.route('**/api/sessions/*/photo', (route) =>
      route.fulfill({
        status: failure.status,
        json: {
          error: failure.message,
          providerError: { code: failure.code, retryable: true },
          session: {
            ...current,
            revision: current.revision + 1,
            providerCalls: 1,
            agentStatus: 'Gemini · photo comparison unavailable',
          },
        },
      }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Find my location', exact: true }).click();
    await page.getByLabel('Upload campus photo', { exact: true }).setInputFiles(fixture);
    await page.getByRole('checkbox', { name: /Send this photo to Google Gemini/ }).check();
    await page
      .getByRole('button', { name: 'Analyze photo against BCIT plans', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(failure.message);
    await expect(page.getByRole('button', { name: /Demo|landmark|checkpoint/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Best match' })).toHaveCount(0);
    await expect(page.getByTestId('provider-status')).toHaveText('Gemini ready');
  });
}
