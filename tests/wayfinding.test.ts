import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { visitorPassages } from '../server/visitor-paths';
import { navigationSchema, planVisitorJourney } from '../server/wayfinding';
import { RouteDirections } from '../src/components/JourneyPanel';
import { RouteMap } from '../src/components/RouteMap';
import type { CampusLocationCandidate } from '../src/types';
import type { TopologyNode } from '../src/topology';
import type { NavigationChoice } from '../src/wayfinding';

const store = new TopologyStore();
const graph = store.read(),
  revision = graph.revision;
const lower = 'sw3-f2-east-lift-to-2605',
  upper = 'sw3-f3-east-lift-to-3615';
function bound(candidateId: string, side: 'from' | 'to' = 'to') {
  const binding = [...graph.candidateAnswers]
    .reverse()
    .find((answer) => answer.candidateId === candidateId)!.bindings!;
  return graph.nodes.find((n) => n.id === binding[side === 'from' ? 'fromNodeId' : 'toNodeId'])!;
}
function candidate(n: TopologyNode): CampusLocationCandidate {
  const p = store.plans.find((p) => p.id === n.planId)!;
  return {
    id: randomUUID(),
    planId: p.id,
    building: p.building,
    floor: p.floor,
    page: p.page,
    sourceRef: p.sourceRef,
    bounds: [n.point.x - 0.001, n.point.y - 0.001, n.point.x + 0.001, n.point.y + 0.001],
    matches: [],
    labelMatches: [],
    confidence: 'low',
    limitations: [],
    verification: 'unverified-ai-hypothesis',
  };
}
function journey(
  n: TopologyNode,
  destination: string,
  overrides: Partial<NavigationChoice> = {},
  source = store,
) {
  const c = candidate(n);
  return planVisitorJourney(
    c,
    {
      revision: 3,
      candidateId: c.id,
      destination,
      originId: n.id,
      networkRevision: source.read().revision,
      ...overrides,
    },
    source,
  );
}

describe('visitor routes on the current three-building pilot', () => {
  it('starts a fresh checkout from published reviews and keeps saved edits across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'campuslens-first-launch-'));
    const file = join(dir, 'topology.json');
    try {
      const snapshot = reviewedNetwork();
      const fresh = new TopologyStore(file, store.plans, store.candidates, reviewedNetwork);
      const data = fresh.snapshot();
      expect(data.document.revision).toBe(snapshot.revision);
      expect(data.eligibility.edgeIds).toHaveLength(snapshot.edges.length);
      expect(data.eligibility.nodeIds).toHaveLength(snapshot.nodes.length);
      expect(data.candidates.find((c) => c.id === 'se12-f2-f3-lift-location')?.state).toBe(
        'rejected',
      );
      const passages = visitorPassages(
        data.document,
        data.eligibility,
        fresh.candidates,
        fresh.plans,
      );
      expect(passages.traces.size).toBe(4);
      expect(passages.doors.size).toBe(2);
      expect(journey(bound(lower), 'SW03 3615', {}, fresh).status).toBe('route');
      expect(JSON.stringify(snapshot)).not.toMatch(
        /"reviewer"|"reviewHistory"|"answeredAt"|"note"/,
      );
      const edge = snapshot.edges.find((e) => e.sourceCandidateId === upper)!;
      fresh.mutate({
        revision: snapshot.revision,
        command: {
          type: 'review',
          target: 'edge',
          id: edge.id,
          status: 'rejected',
          reviewer: 'local fixture',
          note: 'Withdrawn in this checkout',
        },
      });
      const saved = readFileSync(file, 'utf8');
      const reopened = new TopologyStore(file, store.plans, store.candidates, () => {
        throw Error('Must retain local edits');
      });
      expect(journey(bound(lower), 'SW03 3615', {}, reopened).status).toBe('unmapped-destination');
      expect(readFileSync(file, 'utf8')).toBe(saved);
      writeFileSync(file, 'invalid');
      expect(() => fresh.read()).toThrow('not reset');
      expect(readFileSync(file, 'utf8')).toBe('invalid');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('links the two confirmed classroom doors through the east elevator in either direction', () => {
    const forward = journey(bound(lower), 'SW03 Floor 3 room 3615'),
      reverse = journey(bound(upper), 'SW03 2605호로 가고 싶어');
    if (forward.status !== 'route' || reverse.status !== 'route')
      throw Error('Expected both reviewed routes');
    expect(forward.steps.map((s) => s.kind)).toEqual(['corridor', 'elevator', 'corridor']);
    expect(forward.origin.id).toBe(bound(lower).id);
    expect(forward.destination.id).toBe(bound(upper).id);
    expect(reverse.steps.map((s) => s.path)).toEqual(
      [...forward.steps].reverse().map((s) => [...s.path].reverse()),
    );
    for (const s of forward.steps.filter((s) => s.kind === 'corridor')) {
      expect(s.path.length).toBeGreaterThan(2);
      expect(s.path[0]).toEqual(s.from.point);
      expect(s.path.at(-1)).toEqual(s.to.point);
    }
    expect(forward.steps[1].path).toEqual([]);
    const markup = renderToStaticMarkup(
      createElement(RouteDirections, { route: forward, plans: store.plans, onRecheck: () => {} }),
    );
    expect(markup).toContain('data-walking-line="true"');
    expect(markup).toContain('SW3-F2-p1/full.png');
    expect(markup).toContain('Step 2, Elevator');
    expect(markup).toContain('Step 4, Arrival');
    expect(markup).not.toContain('SW3-F3-p1/full.png');
  });
  it.each([
    ['sw3-se12-floor2-passage', 'SW03 2605', lower, 'outdoor'],
    ['sw3-se12-floor3-passage', 'SW03 3615', upper, 'building-link'],
  ])(
    'draws the proper crossing and stops at the door without doubling back via the elevator (%s)',
    (link, destination, room, kind) => {
      const r = journey(bound(link), destination);
      if (r.status !== 'route') throw Error('missing crossing');
      expect(r.steps.map((s) => s.kind)).toEqual([kind, 'corridor']);
      expect(r.steps[0].path).toEqual([]);
      expect(r.steps[1].path).not.toContainEqual(bound(room, 'from').point);
      expect(r.steps[1].path.at(-1)).toEqual(bound(room).point);
      const sheet = store.plans.find((p) => p.id === r.origin.planId)!;
      const markup = renderToStaticMarkup(
        createElement(RouteMap, {
          plan: sheet,
          label: 'Crossing',
          markers: [{ label: 'Door', symbol: 'A', point: r.origin.point }],
          path: r.steps[0].path,
        }),
      );
      expect(markup).not.toContain('<polyline');
    },
  );
  it('offers only points inside the confirmed region and requires explicit selection even for one', () => {
    const n = bound(lower);
    expect(journey(n, 'SW03 3615', { originId: undefined })).toMatchObject({
      status: 'choose-origin',
      origins: [{ id: n.id }],
    });
    expect(journey(n, 'SW03 3615', { originId: bound(upper).id }).status).toBe('choose-origin');
    const c = {
      ...candidate(n),
      bounds: [0.001, 0.001, 0.002, 0.002] as [number, number, number, number],
    };
    expect(
      planVisitorJourney(c, { revision: 1, candidateId: c.id, destination: 'SW03 3615' }, store)
        .status,
    ).toBe('unmapped-origin');
    expect(
      planVisitorJourney(c, { revision: 1, candidateId: c.id, destination: 'SW01 2004' }, store)
        .status,
    ).toBe('unmapped-origin-and-destination');
    expect(() =>
      planVisitorJourney(
        { ...c, planId: 'outside-pilot' },
        { revision: 1, candidateId: c.id, destination: 'SW03 3615' },
        store,
      ),
    ).toThrow('Confirm');
  });
  it('keeps missing labels, unreviewed doors, disconnected stairs and arrival distinct', () => {
    for (const text of ['SW03 2458', 'SW03 03615', 'NE01 3615', 'SW03 3615 and 2605'])
      expect(journey(bound(lower), text).status).toBe('unknown-destination');
    expect(journey(bound(lower), 'SW01 2004')).toMatchObject({
      status: 'unmapped-destination',
      destinations: [{ planId: 'SW1-F2-p1', label: '2004' }],
    });
    expect(journey(bound(lower), 'SE12 S327').status).toBe('no-route');
    expect(journey(bound(upper), 'SW03 3615')).toMatchObject({ status: 'route', steps: [] });
  });
  it('disambiguates destinations, rejects stale choices and preserves qualified room and floor labels', () => {
    const from = bound(lower);
    const options = journey(from, 'S300');
    expect(options.status).toBe('choose-destination');
    const sw1 = options.destinations.find((d) => d.planId.startsWith('SW1-'))!;
    expect(journey(from, 'S300', { destinationId: sw1.id }).status).toBe('unmapped-destination');
    expect(journey(from, 'SW03 elevator').status).toBe('choose-destination');
    expect(journey(from, 'SW03 3층 엘리베이터')).toMatchObject({
      status: 'route',
      destination: { id: bound(upper, 'from').id },
    });
    expect(journey(from, 'SW03 floor 2 3615').status).toBe('unknown-destination');
    expect(journey(from, 'SW03 3615', { destinationId: sw1.id }).status).toBe('choose-destination');
    expect(() => journey(from, 'SW03 3615', { networkRevision: revision - 1 })).toThrow(
      'map changed',
    );
    expect(
      navigationSchema.safeParse({
        candidateId: randomUUID(),
        revision: 1,
        originId: from.id,
        destination: 'SW03 3615',
      }).success,
    ).toBe(false);
  });
  it('rechecks the editable graph and withdraws an overlay after a door-leg review is withdrawn or its shape drifts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'campuslens-visitor-'));
    const file = join(dir, 'topology.json');
    try {
      copyFileSync(store.file, file);
      const live = new TopologyStore(file);
      const q = live.snapshot().candidates.find((c) => c.id === upper)!;
      const ref = (side: 'from' | 'to') => {
        const { planId, sourceSha256, point } = q[side];
        return { planId, sourceSha256, point };
      };
      live.mutate({
        revision,
        command: {
          type: 'answer-candidate',
          candidateId: q.id,
          presentedHash: q.presentedHash,
          from: ref('from'),
          to: ref('to'),
          answer: 'false',
          direction: null,
          reviewer: 'test',
          note: 'test withdrawal',
        },
      });
      expect(journey(bound(lower), 'SW03 3615', {}, live).status).toBe('unmapped-destination');
      expect(journey(bound(lower), 'SW03 floor 2 elevator', {}, live).status).toBe('route');
      const directed = live.snapshot().candidates.find((c) => c.id === upper)!;
      live.mutate({
        revision: live.read().revision,
        command: {
          type: 'answer-candidate',
          candidateId: q.id,
          presentedHash: directed.presentedHash,
          from: ref('from'),
          to: ref('to'),
          answer: 'true',
          direction: 'b-to-a',
          reviewer: 'test',
          note: 'fixture permits leaving the door toward the elevator only',
        },
      });
      expect(journey(bound(lower), 'SW03 3615', {}, live).status).toBe('no-route');
      const oneWay = journey(bound(upper), 'SW03 2605', {}, live);
      if (oneWay.status !== 'route') throw Error('Expected permitted one-way room exit.');
      expect(oneWay.steps[0].path[0]).toEqual(bound(upper).point);
      expect(oneWay.steps[0].path.at(-1)).toEqual(bound(upper, 'from').point);
      const moved = live.snapshot().candidates.find((c) => c.id === upper)!;
      live.mutate({
        revision: live.read().revision,
        command: {
          type: 'answer-candidate',
          candidateId: q.id,
          presentedHash: moved.presentedHash,
          from: ref('from'),
          to: { ...ref('to'), point: { x: 0.55, y: 0.62 } },
          answer: 'true',
          direction: 'both',
          reviewer: 'test',
          note: 'fixture changed door position',
        },
      });
      expect(journey(bound(lower), 'SW03 3615', {}, live).status).toBe('unmapped-destination');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
