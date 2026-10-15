import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { GeminiProvider, type Provider } from '../server/provider';
import type { Session } from '../src/types';
let server: Server, base: string;
const provider: Provider = {
  calls: 0,
  async generate(_contents, _tools, _signal, onAttempt, options) {
    this.calls++;
    onAttempt?.();
    return options?.forceTool === 'select_floor_plans'
      ? [
          {
            functionCall: {
              name: 'select_floor_plans',
              args: {
                planIds: ['SE12-F1-p1'],
                observations: ['Corridor structure in an uploaded test image.'],
                explanation: 'Inspect the source geometry.',
                clarification: '',
              },
            },
          },
        ]
      : [
          {
            functionCall: {
              name: 'propose_campus_locations',
              args: {
                outcome: 'candidates',
                observations: ['Corridor structure.'],
                summary: 'Mocked model result for a real source plan.',
                clarification: 'Confirm the region.',
                candidates: [
                  {
                    planId: 'SE12-F1-p1',
                    bounds: [0.2, 0.3, 0.6, 0.7],
                    confidence: 'low',
                    matches: [{ photoFeature: 'Corridor', planFeature: 'Passage in plan' }],
                    limitations: ['Synthetic test hypothesis; not field validated.'],
                  },
                ],
              },
            },
          },
        ];
  },
};
const image = {
  mimeType: 'image/png',
  data: readFileSync('data/campus/visual/png/SE12-F1-p1/overview.png').toString('base64'),
};
const post = (path: string, body: unknown) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  server = createApp({
    provider,
    liveAvailable: true,
    model: 'gemini-3.8-flash',
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
it('accepts the actual image, compares real plans, returns a confirmable hypothesis, and never retains image bytes', async () => {
  const initial: Session = await (await post('/api/sessions', {})).json();
  const request = {
    requestId: randomUUID(),
    revision: initial.revision,
    consent: true,
    description: '',
    image,
  };
  const before = provider.calls;
  const response = await post(`/api/sessions/${initial.id}/photo`, request);
  expect(response.status).toBe(200);
  const compared: Session = await response.json();
  expect(compared.providerCalls).toBe(2);
  expect(compared.campusAnalysis?.candidates).toHaveLength(1);
  expect(compared.campusLocation).toBeNull();
  expect(JSON.stringify(compared).includes(image.data)).toBe(false);
  expect(compared).not.toHaveProperty('currentNodeId');
  const repeated = await post(`/api/sessions/${initial.id}/photo`, request);
  expect(repeated.status).toBe(200);
  expect(provider.calls - before).toBe(2);
  const confirmed: Session = await (
    await post(`/api/sessions/${initial.id}/actions`, {
      requestId: randomUUID(),
      revision: compared.revision,
      action: {
        type: 'confirm-campus-region',
        candidateId: compared.campusAnalysis!.candidates[0].id,
      },
    })
  ).json();
  expect(confirmed.campusLocation?.building).toBe('SE12');
  expect(confirmed).not.toHaveProperty('route');
  expect(confirmed).not.toHaveProperty('currentNodeId');
  const stored = await (await fetch(`${base}/api/sessions/${initial.id}`)).json();
  expect(JSON.stringify(stored).includes(image.data)).toBe(false);
  const reset: Session = await (
    await post(`/api/sessions/${initial.id}/actions`, {
      requestId: randomUUID(),
      revision: confirmed.revision,
      action: { type: 'reset' },
    })
  ).json();
  expect(reset.mode).toBe('live');
  expect(reset.campusAnalysis).toBeNull();
  expect(reset.campusLocation).toBeNull();
  expect(reset).not.toHaveProperty('route');
});
it('requires per-photo consent and rejects stale requests without spending provider calls', async () => {
  const initial: Session = await (await post('/api/sessions', {})).json();
  const before = provider.calls;
  const request = { requestId: randomUUID(), revision: initial.revision, consent: false, image };
  expect((await post(`/api/sessions/${initial.id}/photo`, request)).status).toBe(400);
  expect(
    (await post(`/api/sessions/${initial.id}/photo`, { ...request, consent: true, revision: 99 }))
      .status,
  ).toBe(409);
  expect(provider.calls).toBe(before);
});
it('rejects mismatched image bytes, oversized bodies, and unproposed campus confirmations', async () => {
  const initial: Session = await (await post('/api/sessions', {})).json();
  const before = provider.calls;
  const request = {
    requestId: randomUUID(),
    revision: 0,
    consent: true,
    image: { ...image, mimeType: 'image/jpeg' },
  };
  expect((await post(`/api/sessions/${initial.id}/photo`, request)).status).toBe(400);
  expect(
    (
      await post(`/api/sessions/${initial.id}/photo`, {
        ...request,
        image: { mimeType: 'image/png', data: 'A'.repeat(4_300_000) },
      })
    ).status,
  ).toBe(413);
  const current: Session = await (await fetch(`${base}/api/sessions/${initial.id}`)).json();
  expect(
    (
      await post(`/api/sessions/${initial.id}/actions`, {
        requestId: randomUUID(),
        revision: current.revision,
        action: { type: 'confirm-campus-region', candidateId: randomUUID() },
      })
    ).status,
  ).toBe(400);
  expect(provider.calls).toBe(before);
});
it('serves PNG and geometry evidence linked by the bootstrap catalogue', async () => {
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  expect(bootstrap.photoLocalizationAvailable).toBe(true);
  expect(bootstrap.visualPlans).toHaveLength(89);
  const plan = bootstrap.visualPlans.find((plan: { id: string }) => plan.id === 'SE12-F1-p1');
  expect((await fetch(base + plan.overview.url)).headers.get('content-type')).toContain(
    'image/png',
  );
  const geometry = await (await fetch(base + plan.geometry.url)).json();
  expect(geometry.sourceId).toBe('SE12-F1');
  expect(geometry.primitives.length).toBeGreaterThan(100);
  expect(geometry.architecturalElements).toEqual([]);
});

it('reports a truncated detail response, rolls back the shortlist, and allows an explicit retry', async () => {
  const selection = {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [
            {
              functionCall: {
                name: 'select_floor_plans',
                args: {
                  planIds: ['SE12-F1-p1'],
                  observations: ['Corridor visible.'],
                  explanation: 'Inspect the plan.',
                  clarification: '',
                },
              },
            },
          ],
        },
      },
    ],
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(selection))
    .mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: { role: 'model' },
            finishMessage: 'private provider detail',
          },
        ],
      }),
    )
    .mockResolvedValueOnce(Response.json(selection))
    .mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'propose_campus_locations',
                    args: {
                      outcome: 'insufficient_evidence',
                      observations: ['Similar corridors.'],
                      summary: 'The photo does not distinguish a region.',
                      clarification: 'Try another view.',
                      candidates: [],
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  const boundedProvider = new GeminiProvider({
    apiKey: 'fake-test-key',
    model: 'gemini-3.8-flash',
    requestsPerMinute: 6,
    requestsPerDay: 60,
    timeoutMs: 1000,
    fetchImpl: fetcher,
  });
  const isolatedServer = createApp({
    provider: boundedProvider,
    liveAvailable: true,
    model: 'gemini-3.8-flash',
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => isolatedServer.once('listening', resolve));
  const origin = `http://127.0.0.1:${(isolatedServer.address() as { port: number }).port}`;
  const send = (path: string, body: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const initial: Session = await (await send('/api/sessions', {})).json();
    const request = { requestId: randomUUID(), revision: initial.revision, consent: true, image };
    const failure = await send(`/api/sessions/${initial.id}/photo`, request);
    expect(failure.status).toBe(502);
    const body = await failure.json();
    expect(body.providerError).toEqual({ code: 'response_limit', retryable: true });
    expect(body.session.mode).toBe('live');
    expect(body.session.providerCalls).toBe(2);
    expect(body.session.campusAnalysis).toBeNull();
    expect(body.session.campusLocation).toBeNull();
    expect(body.session.appliedActions).toEqual([]);
    expect(body.session.activity.map((entry: { tool: string }) => entry.tool)).toEqual([
      'photo_comparison_stopped',
    ]);
    expect(JSON.stringify(body)).not.toContain(image.data);
    expect(JSON.stringify(body)).not.toContain('private provider detail');
    expect(fetcher).toHaveBeenCalledTimes(2);

    const retried = await send(`/api/sessions/${initial.id}/photo`, {
      ...request,
      revision: body.session.revision,
    });
    expect(retried.status).toBe(200);
    const completed: Session = await retried.json();
    expect(completed.campusAnalysis?.outcome).toBe('insufficient_evidence');
    expect(completed.appliedActions).toContain(request.requestId);
    expect(completed.providerCalls).toBe(4);
    expect(completed).not.toHaveProperty('route');
  } finally {
    await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));
  }
});
