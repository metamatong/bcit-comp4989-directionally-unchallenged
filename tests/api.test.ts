import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { photoInput } from './photo-fixtures';
import { createApp } from '../server/app';
import { ProviderError } from '../server/provider';
import type { Session } from '../src/types';
let server: Server, base: string;
const unavailableProvider = {
  calls: 0,
  generate: async () => {
    throw new Error('No provider call is allowed without configuration');
  },
};
const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  server = createApp({
    provider: unavailableProvider,
    liveAvailable: false,
    model: 'gemini-3.8-flash',
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
const start = async (): Promise<Session> => (await post(`${base}/api/sessions`, {})).json();
const action = (
  session: Session,
  value: unknown,
  requestId = randomUUID(),
  revision = session.revision,
) => post(`${base}/api/sessions/${session.id}/actions`, { action: value, requestId, revision });

describe('real-campus-only HTTP contract', () => {
  it('creates a Gemini session with no synthetic state even when credentials are unavailable', async () => {
    const session = await start();
    expect(session.mode).toBe('live');
    expect(session.notice).toContain('needs Gemini setup');
    expect(session.agentStatus).toBe('Gemini · setup required');
    expect(session.campusAnalysis).toBeNull();
    for (const field of [
      'route',
      'currentNodeId',
      'locationCandidates',
      'events',
      'replayStage',
      'destinationId',
      'campusLocation',
    ])
      expect(session).not.toHaveProperty(field);
    expect(session.providerCalls).toBe(0);
  });
  it.each([
    { type: 'mode', mode: 'demo', consent: false },
    { type: 'mode', mode: 'live', consent: true },
    { type: 'replay' },
    { type: 'simulate', scenario: 'block-relevant' },
    { type: 'locate', text: 'Cedar welcome desk', sampleId: 'welcome' },
    { type: 'locate', text: 'hallway', manual: true },
    { type: 'confirm-location', nodeId: 'cedar-entry' },
    { type: 'confirm-campus-region', candidateId: randomUUID() },
    { type: 'destination', text: 'Robotics lab' },
    { type: 'choose-destination', nodeId: 'maple-lab' },
    { type: 'checkpoint' },
    { type: 'preferences', avoidStairs: true, arrivalTime: '' },
  ])('rejects removed action $type without changing state', async (removedAction) => {
    const session = await start();
    expect((await action(session, removedAction)).status).toBe(400);
    const unchanged = await (await fetch(`${base}/api/sessions/${session.id}`)).json();
    expect(unchanged).toEqual(session);
  });
  it('rejects session mode injection and never exposes a default-mode switch or fictional graph', async () => {
    expect((await post(`${base}/api/sessions`, { mode: 'demo' })).status).toBe(400);
    const response = await fetch(`${base}/api/bootstrap`);
    const body = await response.json();
    expect(body.liveAvailable).toBe(false);
    expect(body.coverage.floorPlans).toBe(89);
    expect(body.visualPlans).toHaveLength(89);
    expect(body.directions.available).toBe(true);
    expect(body.directions.nodes).toHaveLength(13);
    expect(body.directions.segmentCount).toBe(14);
    expect(body.directions.mapImage.sourceRef).toBe('burnaby-wayfinding#page=1');
    expect(body).not.toHaveProperty('graph');
    expect(body).not.toHaveProperty('catalogue');
    expect(body).not.toHaveProperty('defaultMode');
    expect(body).not.toHaveProperty('apiKey');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const map = await fetch(`${base}${body.directions.mapImage.url}`);
    expect(map.status).toBe(200);
    expect(map.headers.get('content-type')).toContain('image/png');
    expect((await map.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const pdf = await fetch(`${base}/data/campus/raw/bse1201.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('pdf');
  });
  it('calculates only routes between entries in the source-mapped pilot graph', async () => {
    const response = await post(`${base}/api/directions`, {
      fromNodeId: 'nw4-vicinity',
      destination: 'SE16',
    });
    expect(response.status).toBe(200);
    const { route } = await response.json();
    expect(route.start.id).toBe('nw4-vicinity');
    expect(route.destination.id).toBe('se16-vicinity');
    expect(route.segments.length).toBeGreaterThan(1);
    expect(
      route.segments.every(
        (segment: { sourceRef: string; points: number[][] }) =>
          segment.sourceRef === 'burnaby-wayfinding#page=1' &&
          segment.points.length >= 2 &&
          segment.points.every(
            (point) =>
              point.length === 2 && point.every((coordinate) => coordinate >= 0 && coordinate <= 1),
          ),
      ),
    ).toBe(true);
    expect(route).not.toHaveProperty('steps');
    expect(
      await post(`${base}/api/directions`, {
        fromNodeId: 'unmapped',
        destination: 'SE16',
      }),
    ).toHaveProperty('status', 400);
  });
  it('resolves typed room labels exactly and never claims an indoor route', async () => {
    const response = await post(`${base}/api/directions`, {
      fromNodeId: 'nw4-vicinity',
      destination: 'SE12 Floor 3 302',
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.destination).toMatchObject({
      kind: 'room-label',
      building: 'SE12',
      floor: '3',
      label: 'SE12 · Floor 3 · Room 302',
    });
    expect(result.route.destination.id).toBe('se12-vicinity');
    expect(result.message).toContain('Indoor route to this room is not mapped');
  });
  it('returns a setup error instead of falling back when photo analysis is unconfigured', async () => {
    const session = await start();
    const response = await post(`${base}/api/sessions/${session.id}/photo/evidence`, {
      ...photoInput(),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.providerError).toEqual({ code: 'configuration', retryable: false });
    expect(body.error).toContain('Gemini is not configured');
    expect(body.error).not.toMatch(/demo/i);
    expect(body.session).toEqual(session);
  });
  it('keeps reset idempotent and rejects stale state and removed actions', async () => {
    const initial = await start();
    const requestId = randomUUID();
    const next: Session = await (await action(initial, { type: 'reset' }, requestId)).json();
    const retry = await (await action(initial, { type: 'reset' }, requestId)).json();
    expect(retry).toEqual(next);
    expect(next.mode).toBe('live');
    expect((await action(initial, { type: 'reset' })).status).toBe(409);
    expect(
      (await action(next, { type: 'confirm-campus-region', candidateId: randomUUID() })).status,
    ).toBe(400);
  });
  it('removes general library search while preserving plan assets for location results', async () => {
    const response = await fetch(`${base}/api/search?q=SE12`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown API endpoint.' });
    const plan = await fetch(`${base}/data/campus/visual/png/SE12-F1-p1/overview.png`);
    expect(plan.status).toBe(200);
    expect(plan.headers.get('content-type')).toContain('image/png');
  });
  it('rejects cross-origin writes, malformed bodies, and unknown sessions', async () => {
    const response = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect((await fetch(`${base}/api/sessions/not-a-session`)).status).toBe(404);
    expect(
      (
        await fetch(`${base}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
  });
});

it.each([
  { status: 503, code: 'unavailable' as const, retryAfterSeconds: 60 },
  { status: 429, code: 'quota' as const, retryAfterSeconds: undefined },
])('reports Gemini failure $status without producing a substitute location', async (failure) => {
  const provider = {
    calls: 0,
    async generate(
      _contents: unknown,
      _tools: unknown,
      _signal?: AbortSignal,
      onAttempt?: () => void,
    ) {
      this.calls++;
      onAttempt?.();
      throw new ProviderError(
        'Gemini is unavailable. Try again later.',
        failure.status,
        failure.code,
        true,
        failure.retryAfterSeconds,
      );
    },
  };
  const isolated = createApp({ provider, liveAvailable: true, model: 'gemini-3.8-flash' }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise<void>((resolve) => isolated.once('listening', resolve));
  const origin = `http://127.0.0.1:${(isolated.address() as { port: number }).port}`;
  try {
    const session = await (await post(`${origin}/api/sessions`, {})).json();
    const response = await post(`${origin}/api/sessions/${session.id}/photo/evidence`, {
      ...photoInput(),
    });
    const body = await response.json();
    expect(response.status).toBe(failure.status);
    expect(response.headers.get('retry-after')).toBe(failure.retryAfterSeconds ? '60' : null);
    expect(body.providerError).toMatchObject({ code: failure.code, retryable: true });
    expect(body.session.mode).toBe('live');
    expect(body.session.campusAnalysis).toBeNull();
    expect(body.session.providerCalls).toBe(1);
    expect(body.session.activity.at(-1).tool).toBe('photo_labels_stopped');
    expect(body.error).not.toMatch(/demo/i);
  } finally {
    await new Promise<void>((resolve) => isolated.close(() => resolve()));
  }
});
