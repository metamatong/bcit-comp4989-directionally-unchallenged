import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { GeminiProvider, type Provider } from '../server/provider';
import type { Session } from '../src/types';
import { comparison, comparisonInput, labelReading, photoInput } from './photo-fixtures';

let server: Server, base: string;
const provider: Provider = {
  calls: 0,
  async generate(_contents, _tools, _signal, onAttempt, options) {
    this.calls++;
    onAttempt?.();
    if (options?.forceTool === 'read_photo_labels') return labelReading();
    if (options?.forceTool === 'propose_campus_locations') return comparison();
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
  expect(result.providerCalls).toBe(2);
  expect(result.campusAnalysis?.candidates[0].planId).toBe('SE12-F3-p1');
  expect(result.campusLocation).toBeNull();
  expect(result.photoEvidence).toBeNull();
  expect(result.campusAnalysis?.labelRetrieval.exactMatchPlanIds).toEqual(['SE12-F3-p1']);
  expect(JSON.stringify(result)).not.toContain(input.image.data);
  const repeated = await post(`/api/sessions/${initial.id}/photo`, request);
  expect(repeated.status).toBe(200);
  expect(provider.calls - before).toBe(2);

  const confirmed: Session = await (
    await post(`/api/sessions/${initial.id}/actions`, {
      requestId: randomUUID(),
      revision: result.revision,
      action: {
        type: 'confirm-campus-region',
        candidateId: result.campusAnalysis!.candidates[0].id,
      },
    })
  ).json();
  expect(confirmed.campusLocation?.floor).toBe('3');
  expect(confirmed).not.toHaveProperty('route');
  const stored = await (await fetch(`${base}/api/sessions/${initial.id}`)).json();
  expect(JSON.stringify(stored)).not.toContain(input.detailCrops[0].image.data);
  const reset: Session = await (
    await post(`/api/sessions/${initial.id}/actions`, {
      requestId: randomUUID(),
      revision: confirmed.revision,
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

it('rejects a changed detail crop but permits retrying the same evidence with the original photo', async () => {
  const initial = await start();
  const { session: observed, input } = await readLabels(initial);
  const request = comparisonInput(input, observed.photoEvidence!.id, observed.revision);
  const changed = structuredClone(request);
  changed.detailCrops[0].image.data = readFileSync(
    'data/campus/visual/png/SE12-F3-p1/overview.png',
  ).toString('base64');
  const before = provider.calls;
  const response = await post(`/api/sessions/${initial.id}/photo`, changed);
  expect(response.status).toBe(409);
  const failure = await response.json();
  expect(failure.error).toContain('changed');
  expect(provider.calls).toBe(before);
  const retry = await post(`/api/sessions/${initial.id}/photo`, {
    ...request,
    revision: failure.session.revision,
  });
  expect(retry.status).toBe(200);
  expect(provider.calls - before).toBe(1);
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

it('requires consent for both stages and rejects stale revisions before provider work', async () => {
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

it('serves the same source PNG/geometry while making all labels available to the model', async () => {
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  expect(bootstrap.visualPlans).toHaveLength(89);
  const plan = bootstrap.visualPlans.find((plan: { id: string }) => plan.id === 'SE12-F3-p1');
  expect((await fetch(base + plan.overview.url)).headers.get('content-type')).toContain(
    'image/png',
  );
  const geometry = await (await fetch(base + plan.geometry.url)).json();
  expect(geometry.labels.some((label: { text: string }) => label.text === '302')).toBe(true);
});

it('keeps accepted first-stage evidence when comparison fails and retries only comparison', async () => {
  const wire = (parts: unknown) =>
    Response.json({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(wire(labelReading()))
    .mockResolvedValueOnce(
      Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model' } }] }),
    )
    .mockResolvedValueOnce(wire(comparison({ outcome: 'insufficient_evidence', candidates: [] })));
  const transport = new GeminiProvider({
    apiKey: 'fake-test-key',
    model: 'gemini-3.8-flash',
    requestsPerMinute: 6,
    requestsPerDay: 60,
    timeoutMs: 1000,
    fetchImpl: fetcher,
  });
  const isolated = createApp({
    provider: transport,
    liveAvailable: true,
    model: 'gemini-3.8-flash',
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => isolated.once('listening', resolve));
  const origin = `http://127.0.0.1:${(isolated.address() as { port: number }).port}`;
  try {
    const initial: Session = await (await post('/api/sessions', {}, origin)).json();
    const input = photoInput();
    const observed: Session = await (
      await post(`/api/sessions/${initial.id}/photo/evidence`, input, origin)
    ).json();
    const request = comparisonInput(input, observed.photoEvidence!.id, observed.revision);
    const failed = await post(`/api/sessions/${initial.id}/photo`, request, origin);
    expect(failed.status).toBe(502);
    const failure = await failed.json();
    expect(failure.providerError.code).toBe('response_limit');
    expect(failure.session.photoEvidence.id).toBe(observed.photoEvidence!.id);
    expect(failure.session.campusAnalysis).toBeNull();
    expect(failure.session.activity.map((entry: { tool: string }) => entry.tool)).toEqual([
      'read_photo_labels',
      'photo_comparison_stopped',
    ]);
    const retried = await post(
      `/api/sessions/${initial.id}/photo`,
      { ...request, revision: failure.session.revision },
      origin,
    );
    expect(retried.status).toBe(200);
    expect((await retried.json()).campusAnalysis.outcome).toBe('insufficient_evidence');
    expect(transport.calls).toBe(3);
  } finally {
    await new Promise<void>((resolve) => isolated.close(() => resolve()));
  }
});
