/** Visitor routes must use the corrected source-bound passages and current approval receipts. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { pilotEvidence } from '../server/pilot-evidence';
import { planVisitorNavigation } from '../server/wayfinding';
import { routeDrawingCrossings } from '../server/route-geometry';
import { computeTopologyRoute } from '../server/routing';
import { visitorPassages } from '../server/visitor-paths';
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

function secondFloorStart() {
  const node = store
    .read()
    .nodes.find(
      (item) => item.planId === 'SE12-F2-p1' && item.label === 'Exterior door toward SW03',
    )!;
  return photoStartFixture(node);
}

it.each(['2605', '2082'])(
  'enters SW03 floor 2 beside 2696/S260 when routing to %s',
  async (room) => {
    const candidate = secondFloorStart();
    const route = await planVisitorNavigation(
      candidate,
      {
        revision: 1,
        candidateId: candidate.id,
        destination: `SW03 ${room}`,
      },
      store,
    );
    if (route.status !== 'route') throw Error('Expected the corrected outdoor route');
    expect(route.steps.map((step) => step.kind)).toEqual(['outdoor', 'corridor']);
    expect(route.steps[0].from.point).toEqual({ x: 0.5395, y: 0.5365 });
    expect(route.steps[0].to).toMatchObject({ planId: 'SW3-F2-p1', point: { x: 0.8675, y: 0.45 } });
    expect(route.steps[0].path).toEqual([]);
    expect(route.steps[1].path[0]).toEqual({ x: 0.8675, y: 0.45 });
    expect(route.steps[1].path).not.toContainEqual({ x: 0.5125, y: 0.096 });
    expect(route.steps[1].path.at(-1)).toEqual(route.destination.point);
    if (room === '2605')
      expect(route.steps[1].path).toEqual([
        { x: 0.8675, y: 0.45 },
        { x: 0.8289216, y: 0.45 },
        { x: 0.5346569, y: 0.45 },
        { x: 0.5346569, y: 0.4356061 },
      ]);
    expect(routeDrawingCrossings(route.steps, store.plans)).toEqual([]);
  },
);

it('retains the reverse outdoor transfer from the corrected east entrance to unchanged SE12 B', () => {
  const { document, eligibility, candidates } = store.snapshot();
  const crossing = candidates.find((item) => item.id === 'sw3-se12-floor2-passage')!.latestAnswer!
    .bindings!;
  const passages = visitorPassages(document, eligibility, store.candidates, store.plans);
  const route = computeTopologyRoute(
    document,
    {
      revision: document.revision,
      fromNodeId: crossing.fromNodeId,
      toNodeId: crossing.toNodeId,
      mode: 'fewest-connections',
    },
    store.plans,
    passages.allowed,
  );
  expect(route.outcome).toBe('route');
  expect(route.edgeIds).toEqual([crossing.edgeId]);
  expect(route.nodeIds.map((id) => document.nodes.find((node) => node.id === id)!.point)).toEqual([
    { x: 0.8675, y: 0.45 },
    { x: 0.5395, y: 0.5365 },
  ]);
});
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
  const crossing = route.steps[1];
  expect(crossing.from).toMatchObject({ planId: 'SE12-F3-p1', point: { x: 0.4435, y: 0.631 } });
  expect(crossing.to).toMatchObject({ planId: 'SW3-F3-p1', point: { x: 0.77, y: 0.6325758 } });
  // Independent source coordinates prevent a self-consistent but incorrect north-entry fixture from passing.
  expect(route.steps[2].path).toEqual([
    { x: 0.77, y: 0.6325758 },
    { x: 0.7401961, y: 0.6325758 },
    { x: 0.740196, y: 0.640909 },
  ]);
  expect(route.steps.flatMap((step) => step.path)).not.toContainEqual({ x: 0.4875, y: 0.352 });
  expect(routeDrawingCrossings(route.steps, store.plans)).toEqual([]);
});

it('uses the same east passage in reverse from SW03 2605 to SE12 302', async () => {
  const page = pilotEvidence().find((item) => item.plan.id === 'SW3-F2-p1')!;
  const node = reviewedNetwork().nodes.find((item) => item.label === '2605 · 2600 corridor door')!;
  const door = page.drawnDoors.find(
    (item) =>
      item.room === '2605' && item.point.x === node.point.x && item.point.y === node.point.y,
  )!;
  const candidate = {
    ...photoStartFixture(node),
    bounds: door.corridorBounds ?? null,
    doorwayVicinity: {
      doorId: door.id,
      room: door.room,
      point: door.point,
      sourceSha256: page.plan.sourceSha256,
    },
  };
  const route = await planVisitorNavigation(
    candidate,
    {
      revision: 1,
      candidateId: candidate.id,
      destination: 'SE12 302',
    },
    store,
  );
  if (route.status !== 'route') throw Error('Expected the reverse reviewed route');
  const crossing = route.steps.find((step) => step.kind === 'building-link')!;
  expect(crossing.from).toMatchObject({ planId: 'SW3-F3-p1', point: { x: 0.77, y: 0.6325758 } });
  expect(crossing.to).toMatchObject({ planId: 'SE12-F3-p1', point: { x: 0.4435, y: 0.631 } });
  expect(route.steps.flatMap((step) => step.path)).not.toContainEqual({ x: 0.4875, y: 0.352 });
  expect(routeDrawingCrossings(route.steps, store.plans)).toEqual([]);
});

it.each([
  ['3', 'c94970fa338a29b3f0bee289860ccde2fe5e5034b45fc4bba7b15637d9da2e31'],
  ['2', '48d547d21e0904056e13a3d55945bca7858ffd2e059421853d78f0aed9ad58df'],
])(
  'does not route through a superseded floor-%s north-passage receipt',
  async (floor, oldDefinition) => {
    const document = store.read();
    const answer = document.candidateAnswers.find(
      (item) => item.candidateId === `sw3-se12-floor${floor}-passage`,
    )!;
    answer.definitionHash = oldDefinition;
    writeFileSync(store.file, JSON.stringify(document));
    const candidate = floor === '2' ? secondFloorStart() : start();
    const route = await planVisitorNavigation(
      candidate,
      {
        revision: 1,
        candidateId: candidate.id,
        destination: 'SW03 2605',
      },
      store,
    );
    expect(route.status).toBe('no-route');
  },
);

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
