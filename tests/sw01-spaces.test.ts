/** Replay exact signs through the visitor planner against a fresh import of the published graph. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { floorGraphs } from '../server/floor-graph';
import { locateFromLabels } from '../server/label-localization';
import { reviewedNetwork } from '../server/pilot-network';
import { newSession } from '../server/session';
import { TopologyStore } from '../server/topology';
import { navigationSchema, planVisitorNavigation } from '../server/wayfinding';
import { pointFloor } from '../server/map-points';
import type { PhotoEvidence } from '../src/types';
import type { FloorPin, NavigationChoice, NavigationResult } from '../src/wayfinding';

const directory = mkdtempSync(join(tmpdir(), 'sw01-places-'));
const store = new TopologyStore(
  join(directory, 'topology.json'),
  undefined,
  undefined,
  reviewedNetwork,
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function sign(label: string, building = 'SW1') {
  const session = newSession();
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels: [{ text: label, kind: 'room', placement: 'door', clarity: 'clear', viewId: 'full' }],
    observations: [],
    readAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    usedFallbackModel: false,
  };
  session.photoEvidence = evidence;
  locateFromLabels(
    session,
    { revision: 0, requestId: randomUUID(), evidenceId: evidence.id },
    {
      sessionId: session.id,
      evidence,
      buildingHint: building,
      fingerprint: 'post-extraction-test',
    },
  );
  expect(session.campusLocation).toMatchObject({ building, anchorLabel: label });
  return session.campusLocation!;
}
function walk(
  label: string,
  destination: string,
  building = 'SW1',
  choice: Partial<NavigationChoice> = {},
) {
  const c = sign(label, building);
  return planVisitorNavigation(
    c,
    {
      candidateId: c.id,
      revision: 0,
      networkRevision: store.read().revision,
      destination,
      ...choice,
    },
    store,
  );
}
function route(result: NavigationResult) {
  if (result.status !== 'route') throw Error(result.status + ': ' + result.message);
  return result;
}
it.each(
  [
    ['S190', 'S290', 'S390', 'S490'],
    ['S100', 'S200', 'S300', 'S400'],
    ['S120', 'S220', 'S320', 'S420'],
    ['S140', 'S250', 'S350', 'S450'],
    ['S119', 'S219', 'S319'],
    ['S130', 'S230', 'S330'],
    ['S160', 'S260', 'S360'],
    ['S131', 'S231'],
    ['1040', '2036', '3042', '4038'],
    ['1301', '2325', '2500LB'],
  ].map((labels) => ({ labels })),
)('preserves each confirmed direction and shared landing for $labels', async ({ labels }) => {
  const type = labels[0].startsWith('S') ? 'stairs' : 'elevator';
  for (const order of [labels, [...labels].reverse()]) {
    const trip = route(
      await walk(order[0], 'SW01 ' + order.at(-1), 'SW1', { preferElevators: type === 'elevator' }),
    );
    const transfers = trip.steps.filter((s) => s.kind !== 'corridor');
    expect(transfers).toHaveLength(labels.length - 1);
    expect(
      transfers.every(
        (s) =>
          s.kind === type &&
          s.path.length === 0 &&
          s.from.planId.startsWith('SW1-') &&
          s.to.planId.startsWith('SW1-'),
      ),
    ).toBe(true);
    for (let i = 1; i < transfers.length; i++)
      expect(transfers[i - 1].to.id).toBe(transfers[i].from.id);
    for (const [i, s] of transfers.entries()) {
      expect(s.from.label).toContain(order[i]);
      expect(s.to.label).toContain(order[i + 1]);
    }
  }
});
it('reaches classroom 2016 from SW03 across the signed second-floor crossing', async () => {
  const trip = route(await walk('2063', 'SW01 2016', 'SW3'));
  expect(trip.destination).toMatchObject({ planId: 'SW1-F2-p1', label: '2016' });
  expect(trip.steps.filter((s) => s.kind !== 'corridor').map((s) => s.kind)).toEqual([
    'building-link',
  ]);
});
it('keeps the route from corridor 3000 to classroom 3175 entirely on the third floor', async () => {
  const trip = route(await walk('3000', 'SW01 3175'));
  expect(
    trip.steps.every(
      (s) =>
        s.kind === 'corridor' && s.from.planId === 'SW1-F3-p1' && s.to.planId === s.from.planId,
    ),
  ).toBe(true);
  expect(trip.steps.flatMap((s) => s.path).length).toBeGreaterThan(2);
});
it('binds every confirmed landing to its original sheet, public cell and node version', () => {
  const nodes = store
    .read()
    .nodes.filter(
      (n) => n.planId.startsWith('SW1-') && ['elevator-stop', 'stair-landing'].includes(n.kind),
    );
  expect(nodes).toHaveLength(34);
  for (const n of nodes) {
    const f = floorGraphs().byId.get(n.planId)!;
    expect(f.stairApproach(n)).toBeDefined();
    expect(f.stairApproach({ ...n, version: n.version + 1 })).toBeUndefined();
    expect(f.stairApproach({ ...n, point: { x: 0, y: 0 } })).toBeUndefined();
  }
});
it('routes chosen map cells and rejects walls, stale data and an origin on another floor', async () => {
  const f = floorGraphs().byId.get('SW1-F2-p1')!;
  const [lobby, other] = ['2000', '2016'].map(
    (label) => f.places.find((p) => p.label === label)!.cells[0],
  );
  const pin = (cell: number): FloorPin => ({
    planId: f.plan.id,
    sourceSha256: f.plan.sourceSha256,
    graphVersion: f.version,
    point: f.point(cell),
  });
  const result = route(
    await walk('S290', 'Map point', 'SW1', {
      originPoint: pin(lobby),
      destinationPoint: pin(other),
    }),
  );
  expect(result.origin.point).toEqual(f.point(lobby));
  expect(result.destination.point).toEqual(f.point(other));
  await expect(
    walk('S290', 'Map point', 'SW1', {
      destinationPoint: { ...pin(other), point: { x: 0, y: 0 } },
    }),
  ).rejects.toThrow('shaded');
  await expect(
    walk('S290', 'Map point', 'SW1', {
      originPoint: { ...pin(lobby), graphVersion: '0'.repeat(16) },
    }),
  ).rejects.toThrow('changed');
  await expect(
    walk('S290', 'Map point', 'SW1', { originPoint: { ...pin(lobby), planId: 'SW1-F3-p1' } }),
  ).rejects.toThrow('floor identified');
  const c = sign('S290');
  expect(() => pointFloor(c, 'destination', 'SW03 2605', 'SW1-F2-p1')).toThrow(
    'Named destinations',
  );
  expect(
    navigationSchema.safeParse({
      revision: 0,
      candidateId: c.id,
      destination: 'Map point',
      destinationPoint: pin(other),
    }).success,
  ).toBe(false);
});

it('walks through the confirmed 3130 door to each inner office, with the review controlling the crossing', async () => {
  const c = sign('3000');
  const query = { candidateId: c.id, revision: 0, destination: 'SW01 3124' };
  for (const label of ['3120', '3124', '3126', '3140']) {
    const trip = route(
      await planVisitorNavigation(c, { ...query, destination: 'SW01 ' + label }, store),
    );
    expect(trip.steps.every((s) => s.kind === 'corridor' && s.from.planId === 'SW1-F3-p1')).toBe(
      true,
    );
  }
  const temporary = new TopologyStore(
    join(directory, 'withdrawn-office.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
  const s = temporary.snapshot();
  const answer = s.candidates.find((v) => v.id === 'sw1-f3-3100-to-3130')!.latestAnswer!;
  temporary.mutate({
    revision: s.document.revision,
    command: {
      type: 'review',
      target: 'edge',
      id: answer.bindings!.edgeId,
      status: 'rejected',
      reviewer: 'Regression fixture',
      note: 'Withdraw the office door in this isolated map.',
    },
  });
  expect((await planVisitorNavigation(c, query, temporary)).status).toBe('no-route');
});
it('crosses outdoors between the selected west entrance doors with no invented exterior line', async () => {
  for (const room of ['1000', '1101']) {
    const trip = route(await walk(room, 'SW01 1020'));
    expect(trip.steps.filter((s) => s.kind !== 'corridor')).toMatchObject([
      { kind: 'outdoor', from: { planId: 'SW1-F1-p1' }, to: { planId: 'SW1-F1-p1' }, path: [] },
    ]);
  }
});
it('routes from an interior map cell to its public exit using a room-only terminal leg', async () => {
  const floor = floorGraphs().byId.get('SW1-F2-p1')!;
  const room = floor.places.find((p) => p.label === '2016')!;
  const candidates = (floor.interior?.runs ?? []).filter(
    ([y]) =>
      (y * floor.step) / floor.plan.height > room.bounds[1] - 0.03 &&
      (y * floor.step) / floor.plan.height < room.bounds[3] + 0.03,
  );
  const inside = candidates.flatMap(([y, l, r]) => {
    const x = Math.floor(((room.bounds[0] - 0.005) * floor.plan.width) / floor.step);
    return x >= l && x <= r ? [floor.point(floor.offset + y * floor.width + x)] : [];
  })[0];
  expect(inside).toBeDefined();
  expect(floor.containingCell(inside)).toBeUndefined();
  expect(floor.interiorAt(inside)!.path.length).toBeGreaterThan(1);
  const start = {
    planId: floor.plan.id,
    sourceSha256: floor.plan.sourceSha256,
    graphVersion: floor.version,
    point: inside,
  };
  const trip = route(await walk('2016', 'SW01 2000', 'SW1', { originPoint: start }));
  expect(trip.origin.point).toEqual(inside);
  expect(trip.steps[0].path[0]).toEqual(inside);
});

it('excludes 1494 and the staff passage through 1498 from visitor endpoints and pin routes', async () => {
  const id = 'sw1-f1-visitor-access-1494-via-1498';
  const review = store.snapshot().candidates.find((c) => c.id === id)!;
  expect(review.state).toBe('rejected');
  expect(review.latestAnswer).toMatchObject({ answer: 'false', direction: null, bindings: null });
  expect(reviewedNetwork().edges.some((e) => e.sourceCandidateId === id)).toBe(false);
  expect((await walk('1494', 'SW01 2010')).status).toBe('restricted-place');
  expect((await walk('S190', 'SW01 1494')).status).toBe('restricted-place');
  const f = floorGraphs().byId.get(review.from.planId)!;
  for (const name of ['1494', '1498']) {
    const box = f.places.find((p) => p.label === name)!.bounds;
    const point = { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
    expect(f.containingCell(point)).toBeUndefined();
    expect(f.interiorAt(point)).toBeUndefined();
  }
  for (const mark of [review.from, review.to]) {
    const pin = {
      planId: f.plan.id,
      sourceSha256: f.plan.sourceSha256,
      graphVersion: f.version,
      point: mark.point!,
    };
    expect(f.containingCell(mark.point!)).toBeUndefined();
    expect(f.interiorAt(mark.point!)).toBeUndefined();
    await expect(walk('S190', 'Map point', 'SW1', { destinationPoint: pin })).rejects.toThrow(
      'shaded',
    );
  }
});
it('joins the two leaves of the 1037 vestibule to corridor 1290', async () => {
  const trip = route(await walk('1037', 'SW01 1586'));
  expect(trip.origin.planId).toBe('SW1-F1-p1');
  expect(trip.destination.label).toContain('1586');
  expect(trip.steps.every((s) => s.kind === 'corridor')).toBe(true);
});
it('offers only entrances of a multi-door room that can reach the selected destination', async () => {
  const choice = await walk('1225', 'SW01 1139');
  expect(choice.status).toBe('choose-origin');
  expect(choice.origins.length).toBeGreaterThan(0);
  for (const origin of choice.origins)
    expect((await walk('1225', 'SW01 1139', 'SW1', { originId: origin.id })).status).toBe('route');
});
