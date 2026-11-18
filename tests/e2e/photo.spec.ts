/** Browser transport checks use mocked AI results and do not measure campus accuracy. */
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CampusPhotoAnalysis, Session } from '../../src/types';
import type { NavigationResult } from '../../src/wayfinding';
import { photoStartFixture, walkingRouteFixture } from '../wayfinding-fixtures';

function analysis(
  requestId: string,
  evidenceId: string,
  hasCandidate: boolean,
): CampusPhotoAnalysis {
  return {
    requestId,
    outcome: hasCandidate ? 'candidates' : 'insufficient_evidence',
    observations: ['Mocked photo and floor-plan comparison.'],
    summary: hasCandidate
      ? 'Mocked photo starting area.'
      : 'The image does not distinguish a specific campus region.',
    clarification: 'A second view showing a corridor intersection would help.',
    atlasPlanCount: 12,
    detailedPlanIds: hasCandidate ? ['SE12-F3-p1'] : [],
    buildingHint: null,
    method: 'gemini-photo-floorplan',
    evidenceId,
    labelRetrieval: { indexedLabels: 5463, exactMatchPlanIds: [], clearLabels: [] },
    usedFallbackModel: false,
    generatedAt: new Date().toISOString(),
    candidates: hasCandidate ? [photoStartFixture()] : [],
  };
}

function navigation(): NavigationResult {
  const generated = walkingRouteFixture();
  const stops = [
    { ...generated.origin, id: randomUUID() },
    ...generated.steps.map((step) => ({ ...step.to, id: randomUUID() })),
  ];
  return {
    networkRevision: 29,
    status: 'route',
    origins: [stops[0]],
    destinations: [stops.at(-1)!],
    origin: stops[0],
    destination: stops.at(-1)!,
    steps: generated.steps.map((step, index) => ({
      ...step,
      from: stops[index],
      to: stops[index + 1],
    })),
  };
}

async function setup(page: Page, hasCandidate = true) {
  let current!: Session;
  const uploads: {
    consent: boolean;
    image: { data: string; mimeType: string };
    detailCrops: { id: string; image: { data: string; mimeType: string } }[];
  }[] = [];
  const evidenceUploads: typeof uploads = [];
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/api/bootstrap', async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, liveAvailable: true } });
  });
  await page.route('**/api/sessions', async (route) => {
    current = await (await route.fetch()).json();
    await route.fulfill({ json: current });
  });
  await page.route('**/api/sessions/*/photo/evidence', async (route) => {
    const body = route.request().postDataJSON();
    evidenceUploads.push(body);
    current = {
      ...current,
      revision: current.revision + 1,
      providerCalls: 1,
      photoEvidence: {
        id: randomUUID(),
        requestId: body.requestId,
        labels: [],
        observations: ['Mocked photo evidence.'],
        readAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        usedFallbackModel: false,
      },
    };
    await route.fulfill({ json: current });
  });
  await page.route('**/api/sessions/*/photo/location', async (route) => {
    const body = route.request().postDataJSON();
    uploads.push(body);
    const result = analysis(body.requestId, current.photoEvidence!.id, hasCandidate);
    current = {
      ...current,
      revision: current.revision + 1,
      campusAnalysis: result,
      campusLocation: result.candidates[0] ?? null,
      photoEvidence: null,
      providerCalls: 1,
    };
    await route.fulfill({ json: current });
  });
  await page.route('**/api/sessions/*/navigation', async (route) => {
    expect(route.request().postDataJSON().candidateId).toBe(current.campusLocation?.id);
    await route.fulfill({ json: navigation() });
  });
  await page.route('**/api/sessions/*/actions', async (route) => {
    expect(route.request().postDataJSON().action.type).toBe('reset');
    current = {
      ...current,
      revision: current.revision + 1,
      campusLocation: null,
      campusAnalysis: null,
      photoEvidence: null,
    };
    await route.fulfill({ json: current });
  });
  await page.goto('/');
  await expect(page.getByTestId('provider-status')).toBeVisible();
  return { uploads, evidenceUploads, requests };
}

async function choosePhoto(page: Page) {
  await page
    .getByLabel('Upload campus photo', { exact: true })
    .setInputFiles(resolve('data/campus/visual/png/SE12-F1-p1/overview.png'));
  await expect(page.getByText('Photo ready.', { exact: true })).toBeVisible();
}

async function submitPhoto(page: Page) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Destination', { exact: true }).fill('SW03 2082');
  await page.getByRole('button', { name: 'GO', exact: true }).click();
}

test('submits photo and destination and displays directions without route confirmations', async ({
  page,
}, info) => {
  const { uploads, evidenceUploads, requests } = await setup(page);
  await choosePhoto(page);
  expect(evidenceUploads).toHaveLength(0);
  expect(uploads).toHaveLength(0);
  await submitPhoto(page);
  await expect(
    page.getByRole('heading', { name: 'Walking directions', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Starting area estimated', { exact: true })).toBeVisible();
  await expect(page.locator('.route-floor-label')).toHaveText([
    'SE12 · Floor 3',
    'SW03 · Floor 3',
    'SW03 · Floor 2',
  ]);
  const maps = page.getByRole('group', { name: 'Route maps in travel order' });
  await expect(maps).toHaveCount(1);
  await expect(maps.locator('figure')).toHaveCount(3);
  await expect(maps.locator('figcaption .pin-legend')).toHaveCount(3);
  await expect(page.getByLabel('Route overview', { exact: true })).toHaveText(
    '302 · window-side corridor door → Connecting passage to SW03 · Floor 3 → East elevator at 3696 · corridor 3600 (Floor 3 → 2) → 2082 · 2000 corridor door',
  );
  await expect(page.getByRole('button', { name: 'Show full floors', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Show my position', exact: true })).toBeHidden();
  for (let index = 1; index < 3; index++) {
    const previous = await maps
      .locator('figure')
      .nth(index - 1)
      .boundingBox();
    const current = await maps.locator('figure').nth(index).boundingBox();
    expect(current!.y).toBeGreaterThanOrEqual(previous!.y + previous!.height - 1);
  }
  await expect(
    page.getByRole('button', { name: /^Start at|Confirm this possible region/ }),
  ).toHaveCount(0);
  expect(
    requests.some((url) => url.endsWith('/actions') || url.endsWith('/navigation/origins')),
  ).toBe(false);
  expect(uploads).toHaveLength(1);
  expect(evidenceUploads).toHaveLength(1);
  expect(evidenceUploads[0].detailCrops).toHaveLength(4);
  expect(uploads[0]).not.toHaveProperty('image');
  expect(uploads[0]).not.toHaveProperty('detailCrops');
  expect(evidenceUploads[0].consent).toBe(true);
  expect(evidenceUploads[0].image.mimeType).toBe('image/jpeg');
  expect(evidenceUploads[0].image.data.length).toBeGreaterThan(1000);
  expect(requests.some((url) => url.includes('/ocr/'))).toBe(false);
  await page.getByText('Location evidence', { exact: true }).click();
  const evidence = page.getByRole('region', { name: 'Photo comparison results' });
  await expect(evidence.getByRole('heading', { name: 'SE12 · Floor 3' })).toBeVisible();
  await expect(evidence.locator('.plan-region img')).toHaveAttribute(
    'src',
    /SE12-F3-p1\/overview\.png$/,
  );
  await evidence.getByText('Source files', { exact: true }).click();
  await expect(evidence.getByRole('link', { name: 'View full plan' })).toHaveAttribute(
    'href',
    /SE12-F3-p1\/full\.png$/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('photo-comparison-mocked.png'), fullPage: true });
});

test('ambiguous photo asks for another view without generating a route', async ({ page }) => {
  const { requests } = await setup(page, false);
  await choosePhoto(page);
  await submitPhoto(page);
  await expect(
    page.getByRole('heading', { name: 'Couldn’t find your starting point' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try another photo', exact: true })).toBeVisible();
  expect(requests.some((url) => url.endsWith('/navigation'))).toBe(false);
  await page.getByText('Location evidence', { exact: true }).click();
  await expect(page.getByText('No clear match', { exact: true })).toBeVisible();
  await expect(
    page.getByText('A second view showing a corridor intersection would help.'),
  ).toBeVisible();
});

test('cancelling analysis discards a late comparison response', async ({ page }) => {
  await setup(page);
  await choosePhoto(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/api/sessions/*/photo/location', async (route) => {
    requested = true;
    await wait;
    await route.abort().catch(() => {});
  });
  await submitPhoto(page);
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Cancel analysis', exact: true }).click();
  release();
  await expect(page.getByRole('region', { name: 'Photo comparison results' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Take a photo of where you are' })).toBeVisible();
});

test('starting over clears the photo and directions', async ({ page }) => {
  const { uploads } = await setup(page);
  await choosePhoto(page);
  await submitPhoto(page);
  await expect(
    page.getByRole('heading', { name: 'Walking directions', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Take a photo of where you are', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Walking directions', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByTestId('provider-status')).toHaveText('Gemini ready');
  expect(uploads).toHaveLength(1);
});

test('privacy information keeps the photo local and ready for the next step', async ({ page }) => {
  const { evidenceUploads, uploads } = await setup(page);
  await choosePhoto(page);
  await page.getByRole('button', { name: /Coverage & privacy/ }).click();
  await expect(page.getByRole('dialog', { name: 'About DirectionallyUnchallenged' })).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Selected campus location', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  expect(evidenceUploads).toHaveLength(0);
  expect(uploads).toHaveLength(0);
});
