import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../server/app';
import type { Provider, ModelPart } from '../server/provider';
import { locationCatalogue } from '../server/geolocation';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import type { Session } from '../src/types';
import type { NavigationResult, StartingPoints } from '../src/wayfinding';
import { locationInput, labelReading, photoInput } from './photo-fixtures';

const directory = mkdtempSync(join(tmpdir(), 'wayfinding-api-'));
const store = new TopologyStore(
  join(directory, 'topology.json'),
  undefined,
  undefined,
  reviewedNetwork,
);
const room = store.read().nodes.find((n) => n.label === '302 · window-side corridor door')!;
const captions: string[][] = [];
let modelReading: ModelPart[] = labelReading('302');
const provider: Provider = {
  calls: 0,
  async generate(contents, _tools, _signal, attempt, options) {
    this.calls++;
    attempt?.();
    captions.push(contents.flatMap((c) => c.parts.flatMap((p) => (p.text ? [p.text] : []))));
    if (options?.forceTool === 'read_photo_labels') return modelReading;
    throw Error('Unexpected provider tool');
  },
};
let server: Server, base: string;
beforeAll(async () => {
  server = createApp({ provider, liveAvailable: true, model: 'test', topologyStore: store }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/sessions`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});
const post = (path: string, body: unknown) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

it('takes a consented photo through both stages and uses its complete reviewed route with session checks', async () => {
  const session: Session = await (await post('', {})).json();
  const prefix = '/' + session.id;
  const input = photoInput({ buildingHint: 'SE12' });
  const evidence: Session = await (await post(prefix + '/photo/evidence', input)).json();
  expect(evidence.photoEvidence).not.toBeNull();
  const response = await post(
    prefix + '/photo/location',
    locationInput(evidence.photoEvidence!.id, evidence.revision),
  );
  expect(response.status).toBe(200);
  const match: Session = await response.json();
  expect(match.campusAnalysis?.method).toBe('photo-label-retrieval');
  expect(match.campusAnalysis?.atlasPlanCount).toBe(0);
  expect(captions[0].join(' ')).not.toMatch(/SW3-F|3615|SE12-F/);
  expect(captions).toHaveLength(1);
  const candidateId = match.campusAnalysis!.candidates[0].id;
  expect(match.campusLocation?.id).toBe(candidateId);
  const query = { candidateId, destination: 'SW03 2082', revision: match.revision };
  const nav = (request: object) => post(prefix + '/navigation', request);
  expect((await nav({ ...query, candidateId: randomUUID() })).status).toBe(409);
  expect((await nav({ ...query, revision: 0 })).status).toBe(409);
  const preview = (body: object) => post(prefix + '/navigation/origins', body);
  const identifying = { candidateId, revision: match.revision };
  expect((await preview({ ...identifying, candidateId: randomUUID() })).status).toBe(409);
  expect((await preview({ ...identifying, revision: 0 })).status).toBe(409);
  expect((await preview({ ...identifying, bounds: [0, 0, 1, 1] })).status).toBe(400);
  const options = await preview(identifying);
  expect(options.status).toBe(200);
  const points: StartingPoints = await options.json();
  expect(points.origins.map((s) => s.id)).toEqual([room.id]);
  expect(Object.keys(points).sort()).toEqual(['networkRevision', 'origins']);
  const route = await nav(query);
  expect(route.status).toBe(200);
  expect(route.headers.get('cache-control')).toBe('no-store');
  const directions: NavigationResult = await route.json();
  expect(directions.status).toBe('route');
  if (directions.status !== 'route') throw Error('missing route');
  expect(directions.steps.map((s) => s.kind)).toEqual([
    'corridor',
    'building-link',
    'corridor',
    expect.stringMatching(/^(stairs|elevator)$/),
    'corridor',
  ]);
  const transfer = directions.steps[3];
  expect([transfer.from.planId, transfer.to.planId]).toEqual(['SW3-F3-p1', 'SW3-F2-p1']);
  expect(
    store
      .snapshot()
      .document.edges.some(
        (e) =>
          e.review?.status === 'verified' &&
          e.kind === transfer.kind &&
          ((e.fromNodeId === transfer.from.id && e.toNodeId === transfer.to.id) ||
            (e.direction === 'both' &&
              e.toNodeId === transfer.from.id &&
              e.fromNodeId === transfer.to.id)),
      ),
  ).toBe(true);
  expect(JSON.stringify(directions)).not.toMatch(/reviewer|reviewHistory|data:image|answeredAt/);
  expect((await nav({ ...query, networkRevision: points.networkRevision - 1 })).status).toBe(409);
  expect((await nav({ ...query, path: [{ x: 0, y: 0 }] })).status).toBe(400);
  const other: Session = await (await post('', {})).json();
  expect(
    (await post('/' + other.id + '/navigation', { ...query, revision: other.revision })).status,
  ).toBe(409);
  const newPhoto: Session = await (
    await post(
      prefix + '/photo/evidence',
      photoInput({ scope: 'wayfinding-pilot', revision: match.revision }),
    )
  ).json();
  expect(newPhoto.campusLocation).toBeNull();
  expect((await nav({ ...query, revision: newPhoto.revision })).status).toBe(409);
  expect(provider.calls).toBe(2);
});

it('requires a visitor choice before routing a partial GPS match using the original receipt', async () => {
  const calls = provider.calls;
  modelReading = [
    {
      functionCall: {
        name: 'read_photo_labels',
        args: {
          labels: ['323', '98'].map((text) => ({
            text,
            kind: 'room',
            clarity: 'clear',
            placement: 'door',
            viewId: 'nw',
          })),
          observations: ['Two sign readings were reported.'],
        },
      },
    },
  ];
  try {
    const s: Session = await (await post('', {})).json();
    const path = '/' + s.id;
    const evidence: Session = await (await post(path + '/photo/evidence', photoInput())).json();
    const gps = {
      buildings: ['SE12'],
      accuracy: 6,
      capturedAt: Date.now(),
      sourceSha256: locationCatalogue().geographicSource.sha256,
    };
    const located: Session = await (
      await post(path + '/photo/location', {
        ...locationInput(evidence.photoEvidence!.id, evidence.revision),
        gps,
      })
    ).json();
    expect(located.campusLocation).toBeNull();
    const [candidate] = located.campusAnalysis!.candidates;
    expect(candidate).toMatchObject({ anchorLabel: '323', planId: 'SE12-F3-p1' });
    const q = { candidateId: candidate.id, destination: 'SW03 1710', revision: located.revision };
    expect((await post(path + '/navigation', q)).status).toBe(409);
    const selected: Session = await (
      await post(path + '/actions', {
        requestId: randomUUID(),
        revision: located.revision,
        action: { type: 'confirm-campus-region', candidateId: candidate.id },
      })
    ).json();
    const result = await (
      await post(path + '/navigation', { ...q, revision: selected.revision })
    ).json();
    expect(result.status).toBe('choose-origin');
    expect(result.origins).toHaveLength(2);
    expect(provider.calls - calls).toBe(1);
  } finally {
    modelReading = labelReading('302');
  }
});
