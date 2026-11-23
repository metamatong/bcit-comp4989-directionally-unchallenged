import { gpsHint } from './photo-fixtures';
/** Exercise both floor approaches to each confirmed crossing through visitor localization and routing. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { locateFromLabels } from '../server/label-localization';
import { reviewedNetwork } from '../server/pilot-network';
import { newSession } from '../server/session';
import { TopologyStore } from '../server/topology';
import { topologyContentHash } from '../server/topology-provenance';
import { planVisitorNavigation } from '../server/wayfinding';
import type { PhotoEvidence } from '../src/types';
import type { NavigationResult } from '../src/wayfinding';

let directory: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sw03-sw01-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function navigate(building: string, label: string, destination: string, originId?: string) {
  const session = newSession();
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels: [{ text: label, kind: 'room', clarity: 'clear', viewId: 'full', placement: 'door' }],
    observations: [],
    readAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    usedFallbackModel: false,
  };
  session.photoEvidence = evidence;
  locateFromLabels(
    session,
    { requestId: randomUUID(), revision: 0, evidenceId: evidence.id, gps: gpsHint(building) },
    {
      sessionId: session.id,
      evidence,
      fingerprint: 'post-extraction-sign',
      buildingHint: building,
    },
  );
  const candidate = session.campusLocation!;
  expect(candidate).toMatchObject({ building, anchorLabel: label });
  return planVisitorNavigation(
    candidate,
    {
      candidateId: candidate.id,
      destination,
      revision: 0,
      networkRevision: store.read().revision,
    },
    store,
  );
}

function route(result: NavigationResult) {
  if (result.status !== 'route') throw Error(result.status + ': ' + result.message);
  return result;
}

const crossings = [
  { floor: 1, sw03: '1602', sw01: '1290', type: 'outdoor', id: 'sw03-sw01-f1-lobby-vestibule' },
  { floor: 2, sw03: '2063', sw01: '2070', type: 'building-link', id: 'sw1-sw3-f2-passage-inquiry' },
  { floor: 3, sw03: '3086', sw01: '3080', type: 'building-link', id: 'sw1-sw3-f3-passage-inquiry' },
  { floor: 4, sw03: '4075', sw01: '4076', type: 'building-link', id: 'sw1-sw3-f4-passage-inquiry' },
];

it.each(crossings)(
  'walks between SW03 $sw03 and SW01 $sw01 both ways via floor $floor',
  async (pair) => {
    const snapshot = store.snapshot();
    const review = snapshot.candidates.find((c) => c.id === pair.id)!;
    expect(review.state).toBe('confirmed');
    expect(review.latestAnswer).toMatchObject({
      answer: 'true',
      direction: 'both',
      presentedHash: topologyContentHash({
        definitionHash: review.definitionHash,
        from: review.from,
        to: review.to,
        latestAnswerId: null,
      }),
      from: { planId: 'SW3-F' + pair.floor + '-p1', point: review.from.point },
      to: { planId: 'SW1-F' + pair.floor + '-p1', point: review.to.point },
    });
    const binding = review.latestAnswer!.bindings!;
    const edge = snapshot.document.edges.find((e) => e.id === binding.edgeId)!;
    expect(edge).toMatchObject({
      direction: 'both',
      kind: pair.type,
      distanceMeters: null,
      evidence: { basis: 'user-confirmation', observedOn: null },
    });
    const forward = route(await navigate('SW3', pair.sw03, 'SW01 ' + pair.sw01));
    // For a room with several doors, the return trip starts at the door we just reached.
    const reverse = route(
      await navigate('SW1', pair.sw01, 'SW03 ' + pair.sw03, forward.destination.id),
    );
    for (const [journey, from, to] of [
      [forward, review.from, review.to],
      [reverse, review.to, review.from],
    ] as const) {
      expect(journey.steps.map((s) => s.kind)).toEqual(['corridor', pair.type, 'corridor']);
      expect(journey.steps[1]).toMatchObject({
        from: { planId: from.planId, point: from.point },
        to: { planId: to.planId, point: to.point },
        path: [],
      });
      for (const s of [journey.steps[0], journey.steps[2]]) {
        expect(s.from.planId).toBe(s.to.planId);
        expect(s.path.length).toBeGreaterThan(1);
      }
    }
  },
);

it('joins both reviewed indoor passages through the SW03 corridor for SE12 302 to SW01 3080', async () => {
  const journey = route(await navigate('SE12', '302', 'SW01 3080'));
  expect(journey.steps.map((s) => s.kind)).toEqual([
    'corridor',
    'building-link',
    'corridor',
    'building-link',
    'corridor',
  ]);
  expect(journey.steps[2]).toMatchObject({
    from: { planId: 'SW3-F3-p1' },
    to: { planId: 'SW3-F3-p1' },
  });
  expect(journey.steps[2].path.length).toBeGreaterThan(2);
  expect(journey.destination).toMatchObject({ planId: 'SW1-F3-p1', label: '3080' });
});

it('removes the crossing when its approval is withdrawn, including on otherwise connected floor grids', async () => {
  const snapshot = store.snapshot();
  const crossing = snapshot.candidates.find((c) => c.id === 'sw1-sw3-f3-passage-inquiry')!;
  store.mutate({
    revision: snapshot.document.revision,
    command: {
      type: 'review',
      target: 'edge',
      id: crossing.latestAnswer!.bindings!.edgeId,
      status: 'rejected',
      reviewer: 'Regression fixture',
      note: 'Withdraw the floor 3 crossing in this test copy.',
    },
  });
  const detour = route(await navigate('SW3', '3086', 'SW01 3080'));
  const withdrawn = crossing.latestAnswer!.bindings!;
  expect(
    detour.steps.some((s) => s.from.id === withdrawn.fromNodeId && s.to.id === withdrawn.toNodeId),
  ).toBe(false);
  expect(detour.steps.some((s) => s.kind === 'stairs' || s.kind === 'elevator')).toBe(true);
});

it('retains incoming-only access to both 1710 doors while the lobby can be traversed both ways', async () => {
  const snapshot = store.snapshot();
  for (const id of ['sw3-f1-s160-to-1710', 'sw3-f1-s160-to-1710-corridor-1700']) {
    const door = snapshot.candidates.find((c) => c.id === id)!.latestAnswer!.bindings!.toNodeId;
    const result = await navigate('SW3', '1710', 'SW01 1290', door);
    expect(result.origins.map((o) => o.id)).toContain(door);
    expect(result.status).toBe('no-route');
  }
});
