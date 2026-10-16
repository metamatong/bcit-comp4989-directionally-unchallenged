import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CampusPhotoAnalysis, Session } from '../../src/types';

function analysis(requestId: string, evidenceId: string, hasCandidate = true): CampusPhotoAnalysis {
  return {
    requestId,
    outcome: hasCandidate ? 'candidates' : 'insufficient_evidence',
    observations: ['The test image contains visible scene structure.'],
    summary: hasCandidate
      ? 'Mocked transport example: review this unverified region in an actual BCIT plan.'
      : 'The image does not distinguish a specific campus region.',
    clarification: 'A second view showing a corridor intersection would help.',
    atlasPlanCount: 89,
    detailedPlanIds: hasCandidate ? ['SE12-F1-p1'] : [],
    buildingHint: null,
    method: 'gemini-photo-floorplan',
    evidenceId,
    labelRetrieval: { indexedLabels: 5463, exactMatchPlanIds: [], clearLabels: [] },
    usedFallbackModel: false,
    generatedAt: new Date().toISOString(),
    candidates: hasCandidate
      ? [
          {
            id: randomUUID(),
            planId: 'SE12-F1-p1',
            sourceRef: 'SE12-F1#page=1',
            building: 'SE12',
            floor: '1',
            page: 1,
            bounds: [0.4, 0.25, 0.7, 0.55],
            confidence: 'low',
            matches: [
              {
                photoFeature: 'An elongated scene',
                planFeature: 'A passage region in the supplied drawing',
              },
            ],
            limitations: [
              'This screenshot uses mocked provider results to verify the interface, not localization accuracy.',
            ],
            labelMatches: [],
            verification: 'unverified-ai-hypothesis',
          },
        ]
      : [],
  };
}
async function setup(page: Page, hasCandidate = true) {
  let current!: Session;
  const uploads: {
    consent: boolean;
    image: { data: string; mimeType: string };
    detailCrops: { id: string; image: { data: string; mimeType: string } }[];
  }[] = [];
  const evidenceUploads: unknown[] = [];
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/api/bootstrap', async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, liveAvailable: true } });
  });
  await page.route('**/api/sessions', async (route) => {
    current = {
      ...(await (await route.fetch()).json()),
      mode: 'live',
      agentStatus: 'Live AI · ready',
    };
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
        observations: ['Visible scene structure.'],
        readAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        usedFallbackModel: false,
      },
    };
    await route.fulfill({ json: current });
  });
  await page.route('**/api/sessions/*/photo', async (route) => {
    const body = route.request().postDataJSON();
    uploads.push(body);
    current = {
      ...current,
      revision: current.revision + 1,
      campusAnalysis: analysis(body.requestId, current.photoEvidence!.id, hasCandidate),
      photoEvidence: null,
      providerCalls: 3,
      agentStatus: 'Live AI · photo and floor-plan comparison completed',
    };
    await route.fulfill({ json: current });
  });
  await page.route('**/api/sessions/*/actions', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action.type === 'reset') {
      current = {
        ...current,
        revision: current.revision + 1,
        campusAnalysis: null,
        photoEvidence: null,
        activity: [],
        providerCalls: 0,
      };
    } else throw new Error('Unexpected action in photo test');
    await route.fulfill({ json: current });
  });
  await page.goto('/');
  await expect(page.getByTestId('provider-status')).toBeVisible();
  return { uploads, evidenceUploads, requests };
}
async function choosePhoto(page: Page) {
  await page.getByRole('button', { name: 'Find my location', exact: true }).click();
  await page
    .getByLabel('Upload campus photo', { exact: true })
    .setInputFiles(resolve('data/campus/visual/png/SE12-F1-p1/overview.png'));
  await expect(page.getByText(/Photo ready\. Choose Analyze/)).toBeVisible();
}

test('photo → explicit consent → popup progress → main-page results (mocked provider)', async ({
  page,
}) => {
  const { uploads, evidenceUploads, requests } = await setup(page);
  await choosePhoto(page);
  const analyze = page.getByRole('button', {
    name: 'Analyze photo against BCIT plans',
    exact: true,
  });
  await expect(analyze).toBeDisabled();
  expect(uploads).toHaveLength(0);
  await page.getByRole('checkbox', { name: /Send this photo and its detail views/ }).check();
  await analyze.click();
  await expect(page.getByRole('heading', { name: 'SE12 · Floor 1' })).toHaveCount(1);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('main .plan-region img')).toHaveCount(1);
  await expect(page.locator('main .plan-region img')).toHaveAttribute(
    'src',
    /SE12-F1-p1\/overview\.png$/,
  );
  expect(uploads).toHaveLength(1);
  expect(evidenceUploads).toHaveLength(1);
  expect(uploads[0].detailCrops).toHaveLength(4);
  expect(uploads[0].consent).toBe(true);
  expect(uploads[0].image.mimeType).toBe('image/jpeg');
  expect(uploads[0].image.data.length).toBeGreaterThan(1000);
  expect(uploads[0]).not.toHaveProperty('description');
  expect(requests.some((url) => url.includes('/ocr/'))).toBe(false);
  await expect(page.getByRole('link', { name: 'Source plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm this possible region' })).toHaveCount(0);
  await expect(page.getByText('From estimated SE12 area')).toBeVisible();
  await page.getByRole('textbox', { name: 'Destination' }).fill('SE16');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByText('SE16 map-side vicinity', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', {
      name: /Visual route from SE12 map-side vicinity to SE16 map-side vicinity/,
    }),
  ).toBeVisible();
  await expect(page.locator('.route-map polyline')).not.toHaveCount(0);
  await expect(page.locator('.route-map img')).toHaveJSProperty('complete', true);
  await expect(page.locator('.route-map img')).not.toHaveJSProperty('naturalWidth', 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('ambiguous photo asks for another view and never supplies a demo match', async ({ page }) => {
  await setup(page, false);
  await choosePhoto(page);
  await page.getByRole('checkbox', { name: /Send this photo and its detail views/ }).check();
  await page.getByRole('button', { name: 'Analyze photo against BCIT plans', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('No clear match', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Confirm this possible region' }),
  ).toHaveCount(0);
  await expect(
    page.getByText('A second view showing a corridor intersection would help.'),
  ).toBeVisible();
});

test('closing the photo dialog discards a late comparison response', async ({ page }) => {
  await setup(page);
  await choosePhoto(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/api/sessions/*/photo', async (route) => {
    requested = true;
    await wait;
    await route.abort().catch(() => {});
  });
  await page.getByRole('checkbox', { name: /Send this photo and its detail views/ }).check();
  await page.getByRole('button', { name: 'Analyze photo against BCIT plans', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  release();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Estimated location' })).toHaveCount(0);
  await expect(page.getByTestId('provider-status')).toBeVisible();
});

test('clearing an analysis removes the result without changing provider or loading sample data', async ({
  page,
}) => {
  const { uploads } = await setup(page);
  await choosePhoto(page);
  await page.getByRole('checkbox', { name: /Send this photo and its detail views/ }).check();
  await page.getByRole('button', { name: 'Analyze photo against BCIT plans', exact: true }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Location result' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Estimated location' })).toHaveCount(0);
  await expect(page.getByTestId('provider-status')).toHaveText('Gemini ready');
  expect(uploads).toHaveLength(1);
});
