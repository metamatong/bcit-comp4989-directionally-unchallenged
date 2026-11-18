/** Visitor entry-point regressions for complete reviewed routes and AI coverage beyond that graph. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { pilotEvidence } from '../server/pilot-evidence';
import { planVisitorNavigation } from '../server/wayfinding';
import { routeDrawingCrossings } from '../server/route-geometry';
import { photoStartFixture } from './wayfinding-fixtures';

let directory: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reviewed-navigation-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function start() {
  const page = pilotEvidence().find((item) => item.plan.id === 'SE12-F3-p1')!;
  const door = page.drawnDoors.find((item) => item.room === '302')!;
  return {
    ...photoStartFixture(),
    bounds: door.corridorBounds ?? null,
    doorwayVicinity: {
      doorId: door.id,
      room: door.room,
      point: door.point,
      sourceSha256: page.plan.sourceSha256,
    },
  };
}
it('returns the stored 302-to-2605 route without an AI dependency', async () => {
  const candidate = start();
  const route = await planVisitorNavigation(
    candidate,
    { revision: 1, candidateId: candidate.id, destination: 'SW03 2605' },
    store,
  );
  expect(route.status).toBe('route');
  if (route.status !== 'route') throw Error('Missing reviewed route');
  expect(route.steps.map((step) => step.kind)).toEqual([
    'corridor',
    'building-link',
    'corridor',
    'elevator',
    'corridor',
  ]);
  expect(route.origin.point).toEqual(candidate.doorwayVicinity.point);
  expect(route.destination.label).toBe('2605 · 2600 corridor door');
  expect(routeDrawingCrossings(route.steps, store.plans)).toEqual([]);
});

it('does not reuse a graph path after its elevator approval is withdrawn', async () => {
  const document = store.read();
  const elevator = document.edges.find((edge) => edge.kind === 'elevator')!;
  store.mutate({
    revision: document.revision,
    command: {
      type: 'review',
      target: 'edge',
      id: elevator.id,
      status: 'rejected',
      reviewer: 'Regression',
      note: 'Withdrawn in isolated fixture.',
    },
  });
  const candidate = start();
  const route = await planVisitorNavigation(
    candidate,
    { revision: 1, candidateId: candidate.id, destination: 'SW03 2605' },
    store,
  );
  expect(route.status).toBe('no-route');
});

it('reports a source destination whose approach is absent from the reviewed graph', async () => {
  const candidate = start();
  const result = await planVisitorNavigation(
    candidate,
    { revision: 1, candidateId: candidate.id, destination: 'SW03 1710' },
    store,
  );
  expect(result).toMatchObject({
    status: 'unmapped-destination',
    destinations: [{ planId: 'SW3-F1-p1', label: '1710' }],
  });
});

it('does not select a reviewed start from outside the photo-derived area', async () => {
  const candidate = {
    ...photoStartFixture(),
    bounds: [0.001, 0.001, 0.002, 0.002] as [number, number, number, number],
  };
  expect(
    (
      await planVisitorNavigation(
        candidate,
        { revision: 1, candidateId: candidate.id, destination: 'SW03 2605' },
        store,
      )
    ).status,
  ).toBe('unmapped-origin');
});
