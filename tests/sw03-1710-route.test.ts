/** Both confirmed 1710 doors are reachable only through current source-bound route approvals. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { planVisitorNavigation, navigationSchema } from '../server/wayfinding';
import { visitorPassages } from '../server/visitor-paths';
import { routeDrawingCrossings } from '../server/route-geometry';
import { computeTopologyRoute } from '../server/routing';
import { photoStartFixture } from './wayfinding-fixtures';

const lobby = 'sw3-f1-s160-to-1710';
const northern = 'sw3-f1-s160-to-1710-corridor-1700';
let directory: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'confirmed-1710-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function navigate() {
  const candidate = photoStartFixture();
  return planVisitorNavigation(
    candidate,
    { revision: 1, candidateId: candidate.id, destination: 'SW03 1710' },
    store,
  );
}
function withdraw(id: string) {
  const snapshot = store.snapshot();
  const edgeId = snapshot.candidates.find((item) => item.id === id)!.latestAnswer!.bindings!.edgeId;
  store.mutate({
    revision: snapshot.document.revision,
    command: {
      type: 'review',
      target: 'edge',
      id: edgeId,
      status: 'rejected',
      reviewer: 'Regression fixture',
      note: 'Withdraw only in this isolated test copy.',
    },
  });
}

it.each([
  ['B', northern, { x: 0.4833333, y: 0.5575758 }],
  ['C', lobby, { x: 0.474183, y: 0.489899 }],
] as const)(
  'reaches confirmed entrance %s when the other approach is withdrawn',
  async (_name, other, point) => {
    withdraw(other);
    const result = await navigate();
    if (result.status !== 'route') throw Error('Expected the confirmed 1710 route');
    expect(result.destination).toMatchObject({ planId: 'SW3-F1-p1', point });
    expect(result.steps.map((step) => step.kind)).toEqual([
      'corridor',
      'building-link',
      'corridor',
      'stairs',
      'stairs',
      'corridor',
    ]);
    expect(
      result.steps
        .filter((step) => step.kind === 'stairs')
        .map((step) => [step.from.planId, step.to.planId]),
    ).toEqual([
      ['SW3-F3-p1', 'SW3-F2-p1'],
      ['SW3-F2-p1', 'SW3-F1-p1'],
    ]);
    const data = store.snapshot();
    const network = visitorPassages(data.document, data.eligibility, store.candidates, store.plans);
    const openings = [...network.traces.values()].flatMap((trace) => trace.doorwayOpenings);
    expect(routeDrawingCrossings(result.steps, store.plans).length).toBeGreaterThan(0);
    expect(routeDrawingCrossings(result.steps, store.plans, openings)).toEqual([]);
  },
);

it('rejects missing staircase or room approaches instead of inventing an alternative', async () => {
  withdraw('sw3-f1-f2-s160-s260');
  expect((await navigate()).status).toBe('no-route');
});

it('withdraws both room bindings when the source doorway-aperture definitions change', async () => {
  for (const id of [lobby, northern]) {
    const candidate = store.candidates.find((item) => item.id === id)!;
    candidate.drawingTrace!.doorwayOpenings![0].bounds = [0, 0, 0.1, 0.1];
  }
  const data = store.snapshot();
  const network = visitorPassages(data.document, data.eligibility, store.candidates, store.plans);
  expect([...network.traces.values()].flatMap((trace) => trace.doorwayOpenings)).toEqual([]);
  expect((await navigate()).status).toBe('unmapped-destination');
});

it('does not let a visitor submit drawing exemptions', () => {
  const candidate = photoStartFixture();
  expect(
    navigationSchema.safeParse({
      revision: 1,
      candidateId: candidate.id,
      destination: 'SW03 1710',
      doorwayOpenings: [],
    }).success,
  ).toBe(false);
});

it('does not infer a reverse route from the confirmed incoming directions', () => {
  const data = store.snapshot();
  const node = data.candidates.find((item) => item.id === lobby)!.latestAnswer!.bindings!.toNodeId;
  const start = data.document.nodes.find(
    (item) => item.label === '302 · window-side corridor door',
  )!.id;
  const allowed = visitorPassages(
    data.document,
    data.eligibility,
    store.candidates,
    store.plans,
  ).allowed;
  expect(
    computeTopologyRoute(
      data.document,
      {
        revision: data.document.revision,
        fromNodeId: node,
        toNodeId: start,
        mode: 'fewest-connections',
      },
      store.plans,
      allowed,
    ).outcome,
  ).toBe('no-route');
});
