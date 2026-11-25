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

async function setup(page: Page, hasCandidate = true, mapPicker = false) {
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
    if (mapPicker && result.candidates[0]) result.candidates[0].sourcePlaceId = 'mock-source-place';
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
  await expect(page.getByRole('heading', { name: 'Snap a nearby room sign' })).toBeVisible();
  return { uploads, evidenceUploads, requests };
}

async function choosePhoto(page: Page) {
  await page
    .getByLabel('Upload campus photo', { exact: true })
    .setInputFiles(resolve('data/campus/visual/png/SE12-F1-p1/overview.png'));
  // Auto-advances directly to the Destination screen once local preparation completes.
  await expect(page.getByLabel('Destination', { exact: true })).toBeVisible();
}

async function submitPhoto(page: Page) {
  await page.getByLabel('Destination', { exact: true }).fill('SW03 2082');
  await page.getByRole('button', { name: 'Get Directions', exact: true }).click();
}

test('submits photo and destination and displays directions without route confirmations', async ({
  page,
}, info) => {
  const { uploads, evidenceUploads, requests } = await setup(page);
  await choosePhoto(page);
  expect(evidenceUploads).toHaveLength(0);
  expect(uploads).toHaveLength(0);
  await submitPhoto(page);
  await expect(page.getByRole('button', { name: 'Route overview', exact: true })).toBeVisible();
  await expect(page.locator('.sheet-handle')).toHaveCount(0);
  await expect(page.locator('.map-floating-fab')).toHaveCount(0);
  await expect(page.locator('.guided-step h2')).toHaveCount(0);
  await expect(page.locator('.guided-step-subtitle')).toHaveCount(0);
  await expect(page.locator('.guided-step-instruction')).toHaveText(
    'Follow the blue line to Passage to SW03.',
  );
  const prevBox = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
  const nextBox = await page.getByRole('button', { name: 'Next', exact: true }).boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(prevBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(prevBox!.y + prevBox!.height).toBeLessThanOrEqual(viewportHeight);
  expect(nextBox!.y + nextBox!.height).toBeLessThanOrEqual(viewportHeight);
  await page.getByRole('button', { name: 'Route overview', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Walking directions', exact: true }),
  ).toBeVisible();
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
    '302 · window-side corridor door → Connecting passage to SW03 · Floor 3 → Elevator at East elevator at 3696 · ↓ DOWN · Floor 2. → 2082 · 2000 corridor door',
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

test('3D view follows the active floor and keeps progress across view changes', async ({ page }) => {
  await setup(page);
  await choosePhoto(page);
  await page.context().setGeolocation({ latitude: 49.249972, longitude: -123.001589, accuracy: 2 });
  await submitPhoto(page);
  const toggle = page.getByRole('button', { name: '3D view', exact: true });
  const next = page.getByRole('button', { name: 'Next', exact: true });
  const floor = page.locator('.map-floor-badge');
  const walls = page.locator('.walking-map path').filter({ has: page.locator('title', { hasText: /walls/i }) });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(walls).toHaveCount(1);
  await expect(floor).toHaveText('SE12 · Floor 3');
  await next.click();
  await next.click();
  await expect(floor).toHaveText('SW03 · Floor 3');
  await expect(walls).toHaveCount(1);
  await page.getByRole('button', { name: 'Route overview', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back to steps', exact: true }).click();
  await next.click();
  await next.click();
  await expect(floor).toHaveText('SW03 · Floor 2');
  await toggle.click();
  await expect(walls).toHaveCount(0);
  await expect(floor).toHaveText('SW03 · Floor 2');
  await expect(page.locator('.guided-step-count')).toContainText('Step 5 of 5');
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
  await expect(page.getByRole('heading', { name: 'Snap a nearby room sign' })).toBeVisible();
});

test('starting over clears the photo and directions', async ({ page }) => {
  const { uploads } = await setup(page);
  await choosePhoto(page);
  await submitPhoto(page);
  await page.getByRole('button', { name: 'Route overview', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Walking directions', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Snap a nearby room sign', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Walking directions', exact: true })).toHaveCount(
    0,
  );
  expect(uploads).toHaveLength(1);
});

test('privacy information keeps the photo local and ready for the next step', async ({ page }) => {
  const { evidenceUploads, uploads } = await setup(page);
  await page.getByRole('button', { name: 'Coverage & privacy', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'About DirectionallyUnchallenged' })).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await choosePhoto(page);
  await expect(page.getByRole('button', { name: 'Get Directions', exact: true })).toBeDisabled();
  expect(evidenceUploads).toHaveLength(0);
  expect(uploads).toHaveLength(0);
});

test('picks an explicit destination floor in another building with one photo read', async ({
  page,
}) => {
  const { evidenceUploads } = await setup(page, true, true);
  await page.route('**/api/sessions/*/navigation/surface', (route) =>
    route.fulfill({
      json: {
        planId: route.request().postDataJSON().planId,
        sourceSha256: 'a'.repeat(64),
        graphVersion: 'b'.repeat(16),
        step: 1,
        runs: [[100, 90, 200]],
      },
    }),
  );
  await choosePhoto(page);
  await page.getByRole('button', { name: 'Choose a map point', exact: true }).click();
  await page.getByRole('button', { name: 'Get Directions', exact: true }).click();
  const map = page.getByRole('group', { name: /Select a walking point/ });
  await expect(map).toBeVisible();
  await expect(page.getByLabel('Use point as')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Building', exact: true }).selectOption('SW3');
  const floor = page.getByRole('combobox', { name: 'Floor', exact: true });
  await expect(floor).toHaveValue('');
  await expect(map).toHaveCount(0);
  await floor.selectOption('SW3-F1-p1');
  await expect(map).toHaveAccessibleName('Select a walking point on SW03 · Floor 1');
  await map.focus();
  await map.press('ArrowRight');
  const sent = page.waitForRequest(
    (req) => req.url().endsWith('/navigation') && !!req.postDataJSON().destinationPoint,
  );
  await page.getByRole('button', { name: 'Use this point' }).click();
  expect((await sent).postDataJSON().destinationPoint).toMatchObject({
    planId: 'SW3-F1-p1',
    graphVersion: 'b'.repeat(16),
  });
  expect(evidenceUploads).toHaveLength(1);
});
