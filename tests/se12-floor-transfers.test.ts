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
import { locateFromLabels } from '../server/label-localization';
import { newSession } from '../server/session';
import { planVisitorNavigation } from '../server/wayfinding';

const dir = mkdtempSync(join(tmpdir(), 'se12-vertical-'));
const store = new TopologyStore(join(dir, 'topology.json'), undefined, undefined, reviewedNetwork);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function walk(from: string, to: string) {
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
    { requestId: randomUUID(), revision: 0, evidenceId: evidence.id },
    { sessionId: session.id, evidence, buildingHint: 'SE12', fingerprint: 'post-extraction-sign' },
  );
  expect(result.candidates.map((c) => c.anchorLabel)).toEqual([from]);
  const c = session.campusLocation!;
  const journey = await planVisitorNavigation(
    c,
    { revision: 0, candidateId: c.id, destination: 'SE12 ' + to },
    store,
  );
  if (journey.status !== 'route')
    throw Error(from + ' to ' + to + ': ' + journey.status + ' ' + journey.message);
  return journey;
}

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
