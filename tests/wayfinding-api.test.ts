import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../server/app';
import type { Provider } from '../server/provider';
import { TopologyStore } from '../server/topology';
import type { Session } from '../src/types';
import type { NavigationResult } from '../src/wayfinding';
import { comparison, comparisonInput, labelReading, photoInput, shortlist } from './photo-fixtures';

const store = new TopologyStore();
const room = store.read().nodes.find((n) => n.label === '2605 · 2600 corridor door')!;
const captions: string[][] = [];
const provider: Provider = {
  calls: 0,
  async generate(contents, _tools, _signal, attempt, options) {
    this.calls++;
    attempt?.();
    captions.push(contents.flatMap((c) => c.parts.flatMap((p) => (p.text ? [p.text] : []))));
    if (options?.forceTool === 'read_photo_labels') return labelReading(null);
    if (options?.forceTool === 'select_floor_plans') return shortlist(['SW3-F2-p1']);
    if (options?.forceTool === 'propose_campus_locations') {
      const response = comparison({}, room.planId);
      const args = response[0].functionCall!.args as {
        candidates: { bounds: number[]; labelMatches: unknown[] }[];
      };
      args.candidates[0].bounds = [
        room.point.x - 0.005,
        room.point.y - 0.005,
        room.point.x + 0.005,
        room.point.y + 0.005,
      ];
      args.candidates[0].labelMatches = [];
      return response;
    }
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
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
const post = (path: string, body: unknown) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

it('takes a consented pilot photo through two stages, region and point confirmation to a room-door overlay', async () => {
  const session: Session = await (await post('', {})).json();
  const prefix = '/' + session.id;
  const input = photoInput({ scope: 'wayfinding-pilot' });
  const evidence: Session = await (await post(prefix + '/photo/evidence', input)).json();
  expect(evidence.photoEvidence).not.toBeNull();
  const comparisonBody = comparisonInput(input, evidence.photoEvidence!.id, evidence.revision);
  const mixed = await post(prefix + '/photo', { ...comparisonBody, scope: undefined });
  expect(mixed.status).toBe(409);
  const corrected: Session = (await mixed.json()).session;
  const response = await post(prefix + '/photo', {
    ...comparisonBody,
    revision: corrected.revision,
  });
  expect(response.status).toBe(200);
  const match: Session = await response.json();
  expect(match.campusAnalysis?.atlasPlanCount).toBe(12);
  expect(captions[0].join(' ')).not.toMatch(/SW3-F|3615|SE12-F/);
  const overviewIds = captions[1].filter((c) => c.startsWith('Official plan '));
  expect(overviewIds).toHaveLength(12);
  expect(overviewIds.every((c) => /^Official plan (?:SW1|SW3|SE12)-F/.test(c))).toBe(true);
  expect(captions.flat().join(' ')).not.toContain('Destination:');
  const candidateId = match.campusAnalysis!.candidates[0].id;
  const query = { candidateId, destination: 'SW03 3615', revision: match.revision };
  const nav = (request: object) => post(prefix + '/navigation', request);
  expect((await nav(query)).status).toBe(409);
  const confirmed: Session = await (
    await post(prefix + '/actions', {
      requestId: randomUUID(),
      revision: match.revision,
      action: { type: 'confirm-campus-region', candidateId },
    })
  ).json();
  const request = { ...query, revision: confirmed.revision };
  const choices: NavigationResult = await (await nav(request)).json();
  expect(choices).toMatchObject({ status: 'choose-origin', origins: [{ id: room.id }] });
  const complete = { ...request, networkRevision: choices.networkRevision, originId: room.id };
  const route = await nav(complete);
  expect(route.status).toBe(200);
  expect(route.headers.get('cache-control')).toBe('no-store');
  const directions: NavigationResult = await route.json();
  expect(directions.status).toBe('route');
  if (directions.status !== 'route') throw Error('missing route');
  expect(directions.steps.map((s) => s.kind)).toEqual(['corridor', 'elevator', 'corridor']);
  expect(JSON.stringify(directions)).not.toMatch(/reviewer|reviewHistory|data:image|answeredAt/);
  expect((await nav({ ...complete, networkRevision: choices.networkRevision - 1 })).status).toBe(
    409,
  );
  expect((await nav({ ...complete, path: [{ x: 0, y: 0 }] })).status).toBe(400);
  const other: Session = await (await post('', {})).json();
  expect(
    (await post('/' + other.id + '/navigation', { ...complete, revision: other.revision })).status,
  ).toBe(409);
  const newPhoto: Session = await (
    await post(
      prefix + '/photo/evidence',
      photoInput({ scope: 'wayfinding-pilot', revision: confirmed.revision }),
    )
  ).json();
  expect(newPhoto.campusLocation).toBeNull();
  expect((await nav({ ...complete, revision: newPhoto.revision })).status).toBe(409);
  expect(provider.calls).toBe(4);
});
