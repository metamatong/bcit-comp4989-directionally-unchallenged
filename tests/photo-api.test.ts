import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import type { Provider } from '../server/provider';
import type { Session } from '../src/types';
import { labelReading, locationInput, photoInput } from './photo-fixtures';
import type { PhotoEvidenceRequest } from '../server/photo-media';
import { locationCatalogue } from '../server/geolocation';
const comparisonInput = (input: PhotoEvidenceRequest, id: string, revision = input.revision + 1) =>
  locationInput(id, revision);

let server: Server, base: string;
const provider: Provider = {
  calls: 0,
  async generate(_contents, _tools, _signal, onAttempt, options) {
    this.calls++;
    onAttempt?.();
    if (options?.forceTool === 'read_photo_labels') return labelReading('302', 'clear', 'SE12');
    throw new Error('Exact 302 lookup must bypass visual shortlisting.');
  },
};
const post = (path: string, body: unknown, origin = base) =>
  fetch(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const start = async (): Promise<Session> => (await post('/api/sessions', {})).json();
async function readLabels(initial: Session) {
  const input = photoInput({ revision: initial.revision });
  const response = await post(`/api/sessions/${initial.id}/photo/evidence`, input);
  expect(response.status).toBe(200);
  const session: Session = await response.json();
  return { session, input };
}
beforeAll(async () => {
  server = createApp({ provider, liveAvailable: true, model: 'gemini-3.8-flash' }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

it('performs two separate API calls before any location result, with idempotency and no retained photos/crops', async () => {
  const initial = await start();
  const before = provider.calls;
  const { session: observed, input } = await readLabels(initial);
  expect(provider.calls - before).toBe(1);
  expect(observed.photoEvidence?.labels[0].text).toBe('302');
  expect(observed.campusAnalysis).toBeNull();
  expect(observed.campusLocation).toBeNull();
  expect(observed).not.toHaveProperty('fingerprint');
  const repeatedRead: Session = await (
    await post(`/api/sessions/${initial.id}/photo/evidence`, input)
  ).json();
  expect(repeatedRead.photoEvidence?.id).toBe(observed.photoEvidence?.id);
  expect(provider.calls - before).toBe(1);

  const request = comparisonInput(input, observed.photoEvidence!.id, observed.revision);
  // A workflow UUID may be reused across endpoints; idempotency is scoped to its stage.
  request.requestId = input.requestId;
  const response = await post(`/api/sessions/${initial.id}/photo`, request);
  expect(response.status).toBe(200);
  const result: Session = await response.json();
  expect(result.providerCalls).toBe(1);
  const se12 = result.campusAnalysis!.candidates.find((c) => c.planId === 'SE12-F3-p1')!;
  expect(se12.anchorLabel).toBe('302');
  expect(result.campusLocation).toMatchObject({ id: se12.id, planId: 'SE12-F3-p1' });
  expect(result.photoEvidence?.id).toBe(observed.photoEvidence!.id);
  expect(result.campusAnalysis?.labelRetrieval.exactMatchPlanIds).toEqual([
    'NE1-F3-p1',
    'SE2-F3-p1',
    'SE12-F3-p1',
  ]);
  expect(JSON.stringify(result)).not.toContain(input.image.data);
  const repeated = await post(`/api/sessions/${initial.id}/photo`, request);
  expect(repeated.status).toBe(200);
  expect(provider.calls - before).toBe(1);

  const removedConfirmation = await post(`/api/sessions/${initial.id}/actions`, {
    requestId: randomUUID(),
    revision: result.revision,
    action: { type: 'confirm-campus-region', candidateId: se12.id },
  });
  expect(removedConfirmation.status).toBe(400);
  expect(result).not.toHaveProperty('route');
  const stored = await (await fetch(`${base}/api/sessions/${initial.id}`)).json();
  expect(JSON.stringify(stored)).not.toContain(input.detailCrops[0].image.data);
  const reset: Session = await (
    await post(`/api/sessions/${initial.id}/actions`, {
      requestId: randomUUID(),
      revision: result.revision,
      action: { type: 'reset' },
    })
  ).json();
  expect(reset.campusAnalysis).toBeNull();
  expect(reset.photoEvidence).toBeNull();
});

it('rejects location requests with missing, invented or cross-session evidence without calling Gemini', async () => {
  const initial = await start(),
    input = photoInput();
  const before = provider.calls;
  expect((await post(`/api/sessions/${initial.id}/photo`, input)).status).toBe(400);
  expect(
    (await post(`/api/sessions/${initial.id}/photo`, comparisonInput(input, randomUUID(), 0)))
      .status,
  ).toBe(409);
  expect(provider.calls).toBe(before);
  const { session: observed, input: readInput } = await readLabels(await start());
  const response = await post(
    `/api/sessions/${initial.id}/photo`,
    comparisonInput(readInput, observed.photoEvidence!.id, 1),
  );
  expect(response.status).toBe(409);
  expect(provider.calls - before).toBe(1);
});

it('rejects image bytes and forged labels in the location request', async () => {
  const initial = await start();
  const { session: observed, input } = await readLabels(initial);
  const request = locationInput(observed.photoEvidence!.id, observed.revision);
  const before = provider.calls;
  for (const extra of [
    { image: input.image },
    { detailCrops: input.detailCrops },
    { labels: ['999'] },
  ]) {
    expect(
      (await post(`/api/sessions/${initial.id}/photo/location`, { ...request, ...extra })).status,
    ).toBe(400);
  }
  const response = await post(`/api/sessions/${initial.id}/photo/location`, request);
  expect(response.status).toBe(200);
  expect(provider.calls).toBe(before);
});

it('rejects expired evidence and invalidates it on reset', async () => {
  const initial = await start();
  const { session: observed, input } = await readLabels(initial);
  const before = provider.calls;
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse(observed.photoEvidence!.expiresAt) + 1);
  let failure;
  try {
    const response = await post(
      `/api/sessions/${initial.id}/photo`,
      comparisonInput(input, observed.photoEvidence!.id, observed.revision),
    );
    expect(response.status).toBe(409);
    failure = await response.json();
    expect(failure.error).toContain('expired');
  } finally {
    clock.mockRestore();
  }
  expect(provider.calls).toBe(before);
  const reset: Session = await (
    await post(`/api/sessions/${initial.id}/actions`, {
      requestId: randomUUID(),
      revision: failure.session.revision,
      action: { type: 'reset' },
    })
  ).json();
  const response = await post(
    `/api/sessions/${initial.id}/photo`,
    comparisonInput(input, observed.photoEvidence!.id, reset.revision),
  );
  expect(response.status).toBe(409);
  expect(provider.calls).toBe(before);
});

it('requires consent for extraction and rejects stale revisions before provider work', async () => {
  const initial = await start(),
    input = photoInput();
  const before = provider.calls;
  expect(
    (await post(`/api/sessions/${initial.id}/photo/evidence`, { ...input, consent: false })).status,
  ).toBe(400);
  expect(
    (await post(`/api/sessions/${initial.id}/photo/evidence`, { ...input, revision: 99 })).status,
  ).toBe(409);
  expect(provider.calls).toBe(before);
  const { session: observed, input: observedInput } = await readLabels(initial);
  const request = comparisonInput(observedInput, observed.photoEvidence!.id, observed.revision);
  expect(
    (await post(`/api/sessions/${initial.id}/photo`, { ...request, consent: false })).status,
  ).toBe(400);
  expect(
    (await post(`/api/sessions/${initial.id}/photo`, { ...request, revision: 0 })).status,
  ).toBe(409);
  expect(provider.calls - before).toBe(1);
});

it('validates every crop and rejects client-supplied labels or oversized bodies', async () => {
  const initial = await start(),
    input = photoInput();
  const before = provider.calls;
  const wrong = structuredClone(input);
  wrong.detailCrops[0].image.mimeType = 'image/jpeg';
  expect((await post(`/api/sessions/${initial.id}/photo/evidence`, wrong)).status).toBe(400);
  expect(
    (await post(`/api/sessions/${initial.id}/photo/evidence`, { ...input, labels: ['302'] }))
      .status,
  ).toBe(400);
  expect(
    (
      await post(`/api/sessions/${initial.id}/photo/evidence`, {
        ...input,
        image: { mimeType: 'image/png', data: 'A'.repeat(4_300_000) },
      })
    ).status,
  ).toBe(413);
  expect(provider.calls).toBe(before);
});

it('serializes the two stages through the same session lock', async () => {
  const initial = await start(),
    input = photoInput();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const replacement = vi
    .spyOn(provider, 'generate')
    .mockImplementationOnce(async (_contents, _tools, _signal, onAttempt) => {
      provider.calls++;
      onAttempt?.();
      entered();
      await gate;
      return labelReading();
    });
  try {
    const first = post(`/api/sessions/${initial.id}/photo/evidence`, input);
    await started;
    expect((await post(`/api/sessions/${initial.id}/photo/evidence`, photoInput())).status).toBe(
      409,
    );
    release();
    expect((await first).status).toBe(200);
  } finally {
    release();
    replacement.mockRestore();
  }
});

it('serves the same source PNG/geometry and preserves every label for retrieval', async () => {
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  expect(bootstrap.visualPlans).toHaveLength(89);
  const plan = bootstrap.visualPlans.find((plan: { id: string }) => plan.id === 'SE12-F3-p1');
  expect((await fetch(base + plan.overview.url)).headers.get('content-type')).toContain(
    'image/png',
  );
  const geometry = await (await fetch(base + plan.geometry.url)).json();
  expect(geometry.labels.some((label: { text: string }) => label.text === '302')).toBe(true);
});

it('reuses extracted evidence after a stale GPS hint without another provider request', async () => {
  const initial = await start();
  const { session: observed } = await readLabels(initial);
  const request = locationInput(observed.photoEvidence!.id, observed.revision);
  const before = provider.calls;
  const failed = await post(`/api/sessions/${initial.id}/photo/location`, {
    ...request,
    gps: {
      buildings: ['SE12'],
      capturedAt: Date.now() - 60000,
      accuracy: 5,
      sourceSha256: locationCatalogue().geographicSource.sha256,
    },
  });
  expect(failed.status).toBe(409);
  const failure = await failed.json();
  expect(failure.session.photoEvidence.id).toBe(observed.photoEvidence!.id);
  const retry = await post(`/api/sessions/${initial.id}/photo/location`, {
    ...request,
    revision: failure.session.revision,
    gps: {
      buildings: ['SE12'],
      capturedAt: Date.now(),
      accuracy: 5,
      sourceSha256: locationCatalogue().geographicSource.sha256,
    },
  });
  expect(retry.status).toBe(200);
  expect((await retry.json()).campusLocation.planId).toBe('SE12-F3-p1');
  expect(provider.calls).toBe(before);
});
