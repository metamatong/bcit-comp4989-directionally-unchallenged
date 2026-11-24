import { gpsHint } from './photo-fixtures';
/** Exercise the published review snapshot and the same floor-grid search as the visitor API. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import type { PhotoEvidence } from '../src/types';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { floorGraphs } from '../server/floor-graph';
import { inferSameBuildingTransfers } from '../server/inferred-transfers';
import { locateFromLabels } from '../server/label-localization';
import { newSession } from '../server/session';
import { planVisitorNavigation, visitorNetworkMap } from '../server/wayfinding';

const dir = mkdtempSync(join(tmpdir(), 'se12-vertical-'));
const store = new TopologyStore(join(dir, 'topology.json'), undefined, undefined, reviewedNetwork);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function planWalk(
  from: string,
  to: string,
  {
    preferElevators = false,
    routeStore = store,
  }: { preferElevators?: boolean; routeStore?: TopologyStore } = {},
) {
  const session = newSession();
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels: [
      { text: from, kind: 'landmark', clarity: 'clear', viewId: 'full', placement: 'other' },
    ],
    observations: [],
    readAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    usedFallbackModel: false,
  };
  session.photoEvidence = evidence;
  const result = locateFromLabels(
    session,
    { requestId: randomUUID(), revision: 0, evidenceId: evidence.id, gps: gpsHint('SE12') },
    { sessionId: session.id, evidence, buildingHint: 'SE12', fingerprint: 'post-extraction-sign' },
  );
  expect(result.candidates.map((c) => c.anchorLabel)).toEqual([from]);
  const c = session.campusLocation!;
  return planVisitorNavigation(
    c,
    { revision: 0, candidateId: c.id, destination: 'SE12 ' + to, preferElevators },
    routeStore,
  );
}

async function walk(from: string, to: string) {
  const journey = await planWalk(from, to);
  if (journey.status !== 'route')
    throw Error(from + ' to ' + to + ': ' + journey.status + ' ' + journey.message);
  return journey;
}

it.each([
  ['302', '100A', ['S300', 'S200', 'S100', '102Z']],
  ['100A', '302', ['102Z', 'S100', 'S200', 'S300']],
  ['201V', '100A', ['201V', 'S200', 'S100', '102Z']],
  ['100A', '201V', ['102Z', 'S100', 'S200', '201V']],
] as const)(
  'reaches SE12 %s to %s via the west stairs and confirmed outdoor approaches',
  async (from, to, via) => {
    const journey = await walk(from, to);
    expect(journey.mappedPortion).toBeUndefined();
    expect(journey.origin.label.split(' · ')[0]).toBe(from);
    expect(journey.destination.label.split(' · ')[0]).toBe(to);
    expect(journey.steps.at(-1)?.path.at(-1)).toEqual(journey.destination.point);

    const transfers = journey.steps.filter((s) => s.kind !== 'corridor');
    const stops = [transfers[0].from, ...transfers.map((s) => s.to)];
    expect(stops.map((stop) => stop.label.split(' · ')[0])).toEqual(via);
    for (const step of transfers) {
      expect(step.kind).toBe(step.from.planId === step.to.planId ? 'outdoor' : 'stairs');
      expect(step.path).toEqual([]);
    }
  },
);

it.each(['se12-f1-s100-to-102z-exterior', 'se12-f2-s200-to-201v-exterior'])(
  'omits the west stair transfer when %s has a superseded confirmation',
  (candidateId) => {
    const document = store.read();
    const candidateAnswers = document.candidateAnswers.map((answer) =>
      answer.candidateId === candidateId ? { ...answer, definitionHash: '0'.repeat(64) } : answer,
    );
    const map = visitorNetworkMap({
      plans: store.plans,
      candidates: store.candidates,
      read: () => ({ ...document, candidateAnswers }),
    });
    const landing = map.nodes.find(
      (n) => n.planId === 'SE12-F1-p1' && n.label.startsWith('S100 ·'),
    )!;
    expect(
      map.doc.edges.some(
        (e) => e.kind === 'stairs' && (e.fromNodeId === landing.id || e.toNodeId === landing.id),
      ),
    ).toBe(false);
  },
);

it('keeps the west stairs out of elevator-only directions', async () => {
  expect((await planWalk('302', '100A', { preferElevators: true })).status).toBe('no-route');
});

it('respects the direction of a one-way outdoor approach to an exterior landing', async () => {
  const routeStore = new TopologyStore(
    join(dir, 'one-way.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
  const snapshot = routeStore.snapshot();
  const approach = snapshot.candidates.find((c) => c.id === 'se12-f1-s100-to-102z-exterior')!;
  routeStore.mutate({
    revision: snapshot.document.revision,
    command: {
      type: 'answer-candidate',
      candidateId: approach.id,
      presentedHash: approach.presentedHash,
      from: {
        planId: approach.from.planId,
        sourceSha256: approach.from.sourceSha256,
        point: approach.from.point!,
      },
      to: {
        planId: approach.to.planId,
        sourceSha256: approach.to.sourceSha256,
        point: approach.to.point!,
      },
      answer: 'true',
      direction: 'a-to-b',
      reviewer: 'Isolated test',
      note: 'Simulate one-way entry from S100 to 102Z.',
    },
  });
  expect((await planWalk('302', '100A', { routeStore })).status).toBe('route');
  expect((await planWalk('100A', '302', { routeStore })).status).toBe('no-route');
});

it('withholds an exterior stair transfer when the upper sheet has two landings with the same sign', () => {
  const map = visitorNetworkMap(store);
  const lower = map.nodes.find((n) => n.planId === 'SE12-F1-p1' && n.label.startsWith('S100 ·'))!;
  const upper = map.nodes.find((n) => n.planId === 'SE12-F2-p1' && n.label.startsWith('S200 ·'))!;
  const duplicate = { ...upper, id: randomUUID(), point: { x: 0.01, y: 0.01 } };
  const outdoor = map.doc.edges.filter(
    (e) => e.kind === 'outdoor' && map.network.allowed.has(e.id),
  );
  const stairs = inferSameBuildingTransfers([...map.nodes, duplicate], map.plans, outdoor);
  expect(stairs.some((e) => e.fromNodeId === lower.id || e.toNodeId === lower.id)).toBe(false);
});

it.each([
  ['S200', 'S300', 'S400'],
  ['S202', 'S313', 'S413'],
  ['S209', 'S327', 'S418'],
  ['S228', 'S328', 'S428'],
])(
  'stitches %s to %s to %s using the same approved middle landing, both ways',
  async (low, mid, high) => {
    const snapshot = store.snapshot();
    const owner = snapshot.candidates.find(
      (c) => c.id === 'se12-f2-f3-' + low.toLowerCase() + '-' + mid.toLowerCase(),
    )!;
    const upper = snapshot.candidates.find(
      (c) => c.id === 'se12-f3-f4-' + mid.toLowerCase() + '-' + high.toLowerCase(),
    )!;
    expect(upper.state).toBe('confirmed');
    expect(upper.latestAnswer).toMatchObject({
      answer: 'true',
      direction: 'both',
      bindings: { fromNodeId: owner.latestAnswer!.bindings!.toNodeId },
    });
    const edge = snapshot.document.edges.find(
      (e) => e.id === upper.latestAnswer!.bindings!.edgeId,
    )!;
    expect(edge.evidence).toMatchObject({ basis: 'user-confirmation', observedOn: null });
    for (const [a, b] of [
      [low, high],
      [high, low],
    ]) {
      const journey = await walk(a, b);
      const transfers = journey.steps.filter((s) => s.kind !== 'corridor');
      expect(
        transfers.map((s) => [s.kind, s.from.label.split(' · ')[0], s.to.label.split(' · ')[0]]),
      ).toEqual([
        ['stairs', a, mid],
        ['stairs', mid, b],
      ]);
      expect(transfers[0].to.id).toBe(transfers[1].from.id);
    }
  },
);

it.each([
  ['208Z', '410C', ['2', '3', '4']],
  ['410C', '208Z', ['4', '3', '2']],
] as const)('walks between the public corridors %s and %s', async (from, to, floors) => {
  const journey = await walk(from, to);
  expect(journey.steps[0].kind).toBe('corridor');
  expect(journey.steps.at(-1)?.kind).toBe('corridor');
  const stairs = journey.steps.filter((s) => s.kind !== 'corridor');
  expect(stairs.map((s) => s.kind)).toEqual(['stairs', 'stairs']);
  expect([stairs[0].from.planId, ...stairs.map((s) => s.to.planId)]).toEqual(
    floors.map((f) => 'SE12-F' + f + '-p1'),
  );
});

it.each(['S300', 'S313', 'S328'])(
  'binds the %s approach through its own drawn opening to the current landing only',
  async (label) => {
    const floor = floorGraphs().byId.get('SE12-F3-p1')!;
    const node = store
      .read()
      .nodes.find((n) => n.planId === floor.plan.id && n.label.split(' · ')[0] === label)!;
    const access = floor.stairApproach(node)!;
    expect(access.via).toHaveLength(2);
    expect(floor.stairApproach({ ...node, version: node.version + 1 })).toBeUndefined();
    expect(floor.stairApproach({ ...node, point: { x: 0.4, y: 0.4 } })).toBeUndefined();
    const route = await walk(label, '317C');
    expect(route.steps.every((s) => s.kind === 'corridor')).toBe(true);
    expect(route.steps[0].path).toContainEqual(access.via[0]);
  },
);
