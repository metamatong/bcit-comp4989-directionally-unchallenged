import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TopologyStore, topologyPlans } from '../server/topology';
import { computeTopologyRoute } from '../server/routing';
import { readConnectionCandidates } from '../server/topology-candidates';
import { topologyContentHash } from '../server/topology-provenance';
import TopologyEditor from '../src/TopologyEditor';
import {
  ConnectionReview,
  DirectionQuestion,
  candidateFocusBounds,
  pointInCandidateView,
} from '../src/components/ConnectionReview';
import type { CandidateAnswer, TopologyCommand } from '../src/topology';

// Test responses are artificial; no campus passage is approved in the real data file.
let directory: string, file: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'campuslens-candidate-'));
  file = join(directory, 'topology.json');
  // Legacy documents with no answer collection must load without losing annotations.
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, revision: 0, updatedAt: null, nodes: [], edges: [] }),
  );
  store = new TopologyStore(file);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function command(
  answer: CandidateAnswer['answer'],
  direction: CandidateAnswer['direction'],
  candidateId?: string,
): Extract<TopologyCommand, { type: 'answer-candidate' }> {
  const candidates = store.snapshot().candidates;
  const candidate = candidateId
    ? candidates.find((item) => item.id === candidateId)!
    : candidates[0];
  const point = (side: 'from' | 'to') => {
    const { planId, sourceSha256, point } = candidate[side];
    if (!point) throw new Error('A marked-point fixture requires a coordinate.');
    return { planId, sourceSha256, point: { ...point } };
  };
  return {
    type: 'answer-candidate',
    candidateId: candidate.id,
    presentedHash: candidate.presentedHash,
    from: point('from'),
    to: point('to'),
    answer,
    direction,
    reviewer: 'Test reviewer',
    note: 'Mock answer; not a campus verification.',
  };
}
function edit(value: TopologyCommand) {
  return store.mutate({ revision: store.read().revision, command: value });
}
function answer(value: CandidateAnswer['answer'], direction: CandidateAnswer['direction'] = null) {
  return edit(command(value, direction));
}
function route(reverse = false) {
  const document = store.read(),
    bindings = document.candidateAnswers.at(-1)!.bindings!;
  return computeTopologyRoute(document, {
    revision: document.revision,
    fromNodeId: reverse ? bindings.toNodeId : bindings.fromNodeId,
    toNodeId: reverse ? bindings.fromNodeId : bindings.toNodeId,
    mode: 'fewest-connections',
  });
}
describe('same-floor corridors joining previously reviewed points', () => {
  const lower = 'sw3-f2-door-to-lift-corridor';
  const upper = 'sw3-f3-lift-to-building-link-corridor';
  function confirmTransitions() {
    const approve = (id: string) =>
      edit(command('true', 'both', id)).document.candidateAnswers.at(-1)!.bindings!;
    return {
      outside: approve('sw3-se12-floor2-passage'),
      lift: approve('sw3-f2-f3-east-lift'),
      bridge: approve('sw3-se12-floor3-passage'),
    };
  }
  it('requires the original reviewed points and never seeds or invents their identities', () => {
    const view = store.snapshot().candidates.find((item) => item.id === lower)!;
    expect(view.waitingForPoints).toBe(true);
    expect(() => edit(command('true', 'both', lower))).toThrow('First confirm');
    expect(store.read().revision).toBe(0);
    expect(store.read().nodes).toEqual([]);
    confirmTransitions();
    const ready = store.snapshot();
    const mismatched = command('true', 'both', lower);
    mismatched.from.point = { x: 0.32, y: 0.18 };
    expect(() => edit(mismatched)).toThrow('shared point');
    expect(store.read()).toEqual(ready.document);
    const leakedNodeId = {
      ...command('true', 'both', lower),
      fromNodeId: ready.document.nodes[0].id,
    };
    expect(() =>
      store.mutate({ revision: ready.document.revision, command: leakedNodeId }),
    ).toThrow('Invalid edit');
  });
  it('allows an end-to-end route only after both missing corridor segments are reviewed in usable directions', () => {
    const { outside, lift, bridge } = confirmTransitions();
    const baseline = store.read();
    function trip(reverse = false) {
      const document = store.read();
      return computeTopologyRoute(document, {
        revision: document.revision,
        mode: 'fewest-connections',
        fromNodeId: reverse ? bridge.toNodeId : outside.toNodeId,
        toNodeId: reverse ? outside.toNodeId : bridge.toNodeId,
      });
    }
    expect(trip().outcome).toBe('no-route');
    for (const answer of ['false', 'unknown', 'true'] as const) {
      edit(command(answer, answer === 'true' ? 'unknown' : null, lower));
      expect(store.read().edges).toEqual(baseline.edges);
    }
    const first = edit(command('true', 'a-to-b', lower)).document.candidateAnswers.at(
      -1,
    )!.bindings!;
    expect(trip().outcome).toBe('no-route');
    const second = edit(command('true', 'both', upper)).document.candidateAnswers.at(-1)!.bindings!;
    expect(store.read().nodes).toEqual(baseline.nodes);
    expect(trip()).toMatchObject({
      outcome: 'route',
      edgeIds: [outside.edgeId, first.edgeId, lift.edgeId, second.edgeId, bridge.edgeId],
      distanceMeters: null,
    });
    expect(trip(true).outcome).toBe('no-route');
    edit(command('true', 'both', lower));
    expect(trip(true).edgeIds).toEqual([
      bridge.edgeId,
      second.edgeId,
      lift.edgeId,
      first.edgeId,
      outside.edgeId,
    ]);
    edit(command('false', null, upper));
    expect(trip().outcome).toBe('no-route');
    expect(store.read().nodes).toEqual(baseline.nodes);
    expect(
      store
        .read()
        .edges.filter((edge) => baseline.edges.some((previous) => previous.id === edge.id)),
    ).toEqual(baseline.edges);
  });
  it('invalidates dependent corridor approvals after a shared landing is edited, retaining source and answer history', () => {
    const { lift } = confirmTransitions();
    const approved = edit(command('true', 'both', lower));
    const edge = approved.document.candidateAnswers.at(-1)!.bindings!.edgeId;
    const stale = command('true', 'both', lower);
    const stop = approved.document.nodes.find((node) => node.id === lift.fromNodeId)!;
    edit({
      type: 'save-node',
      id: stop.id,
      planId: stop.planId,
      kind: stop.kind,
      label: stop.label,
      notes: stop.notes,
      point: { x: stop.point.x + 0.001, y: stop.point.y },
      evidence: stop.evidence,
    });
    expect(store.snapshot().eligibility.edgeIds).not.toContain(edge);
    expect(store.snapshot().candidates.find((item) => item.id === lower)?.waitingForPoints).toBe(
      true,
    );
    edit(command('true', 'both', 'sw3-f2-f3-east-lift'));
    expect(() => edit(stale)).toThrow('changed');
    const latest = store.snapshot().candidates.find((item) => item.id === lower)!;
    expect(latest.to.point).toEqual({ ...stop.point, x: stop.point.x + 0.001 });
    expect(latest.state).toBe('needs-review');
    edit(command('true', 'both', lower));
    expect(store.snapshot().eligibility.edgeIds).toContain(edge);
    expect(store.read().nodes).toHaveLength(6);
  });
  it('shows both existing markers on the same floor with the bend identified in the question', () => {
    confirmTransitions();
    const data = store.snapshot();
    data.candidates = data.candidates.filter((candidate) => candidate.id === lower);
    const markup = renderToStaticMarkup(createElement(TopologyEditor, { initialData: data }));
    expect(markup).toContain('Floor plan with both corridor endpoints');
    expect(markup).toContain('corridor 2000');
    expect(markup).toContain('corridor 2600');
    expect(markup).toContain('class="candidate-pin point-a"');
    expect(markup).toContain('class="candidate-pin point-b"');
    expect(markup).not.toContain('Edit A location or floor');
  });
});
describe('candidate proposals and explicit user answers', () => {
  it('loads source-bound proposals without seeding a routing graph or changing a legacy document', () => {
    const before = readFileSync(file, 'utf8'),
      snapshot = store.snapshot();
    expect(snapshot.candidates.length).toBeGreaterThan(3);
    expect(snapshot.document.candidateAnswers).toEqual([]);
    expect(snapshot.document.nodes).toEqual([]);
    expect(snapshot.document.edges).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(before);
    for (const candidate of snapshot.candidates) {
      expect(candidate.state).toBe('unanswered');
      expect(candidate.blockedReason).toBeNull();
      for (const point of [candidate.from, candidate.to]) {
        expect(point.sourceSha256).toBe(
          topologyPlans.find((plan) => plan.id === point.planId)!.sourceSha256,
        );
        if (point.point) {
          expect(point.point.x).toBeGreaterThanOrEqual(0);
          expect(point.point.y).toBeLessThanOrEqual(1);
        } else {
          expect(candidate.allowsFloorOnlyAnswer).toBe(true);
          expect(candidate.kind).toBe('elevator');
        }
      }
    }
  });
  it('promotes an explicit T plus both-directions answer atomically, without claiming a field visit', () => {
    const next = answer('true', 'both');
    expect(next.document.revision).toBe(1);
    expect(next.document.nodes).toHaveLength(2);
    expect(next.document.edges).toHaveLength(1);
    expect(next.eligibility.edgeIds).toHaveLength(1);
    expect(next.candidates[0].state).toBe('confirmed');
    for (const record of [...next.document.nodes, ...next.document.edges]) {
      expect(record.evidence.basis).toBe('user-confirmation');
      expect(record.evidence.observedOn).toBeNull();
      expect(record.review).toMatchObject({ status: 'verified', reviewer: 'Test reviewer' });
    }
    expect(route().outcome).toBe('route');
    expect(route(true).outcome).toBe('route');
    expect(route().distanceMeters).toBeNull();
    expect(new TopologyStore(file).snapshot()).toEqual(next);
  });
  it.each(['false', 'unknown'] as const)(
    'stores %s with endpoint evidence while leaving topology empty',
    (choice) => {
      const next = answer(choice);
      expect(next.document.nodes).toEqual([]);
      expect(next.document.edges).toEqual([]);
      expect(next.document.candidateAnswers[0]).toMatchObject({
        answer: choice,
        direction: null,
        bindings: null,
      });
      expect(next.candidates[0].state).toBe(choice === 'false' ? 'rejected' : 'deferred');
    },
  );
  it('does not turn unknown direction into an assumed bidirectional or one-way passage', () => {
    const next = answer('true', 'unknown');
    expect(next.document.edges).toEqual([]);
    expect(next.document.nodes).toEqual([]);
    expect(next.candidates[0].state).toBe('needs-direction');
    expect(() => answer('true', null)).toThrow('direction');
    expect(() => answer('false', 'both')).toThrow('direction');
  });
  it.each(['a-to-b', 'b-to-a'] as const)(
    'publishes only the explicitly allowed %s direction',
    (direction) => {
      answer('true', direction);
      expect(route().outcome).toBe(direction === 'a-to-b' ? 'route' : 'no-route');
      expect(route(true).outcome).toBe(direction === 'b-to-a' ? 'route' : 'no-route');
      expect(store.read().edges[0].direction).toBe('forward');
    },
  );
  it('preserves answer history and reuses generated records when the user changes their answer', () => {
    const original = answer('true', 'both');
    const nodeIds = original.document.nodes.map((node) => node.id),
      edgeId = original.document.edges[0].id;
    answer('false');
    expect(route().outcome).toBe('no-route');
    answer('unknown');
    expect(route().outcome).toBe('no-route');
    const final = answer('true', 'a-to-b');
    expect(final.document.candidateAnswers.map((item) => item.answer)).toEqual([
      'true',
      'false',
      'unknown',
      'true',
    ]);
    expect(final.document.nodes.map((node) => node.id)).toEqual(nodeIds);
    expect(final.document.edges.map((edge) => edge.id)).toEqual([edgeId]);
    expect(route().outcome).toBe('route');
    expect(route(true).outcome).toBe('no-route');
  });
  it('keeps a withdrawn user-confirmation edge ineligible even if an old generic approval is replayed', () => {
    const initial = answer('true', 'both'),
      edgeId = initial.document.edges[0].id;
    answer('unknown');
    edit({
      type: 'review',
      target: 'edge',
      id: edgeId,
      status: 'verified',
      reviewer: 'Test',
      note: 'Replay of an obsolete approval.',
    });
    expect(route().outcome).toBe('no-route');
    expect(store.snapshot().eligibility.edgeIds).toEqual([]);
  });
  it('retains corrected proposal points for F or deferred answers without creating records', () => {
    const correction = command('unknown', null);
    correction.from.point = { x: 0.31, y: 0.45 };
    const next = edit(correction);
    expect(next.candidates[0].from.point).toEqual(correction.from.point);
    expect(next.document.nodes).toEqual([]);
    const confirmed = answer('true', 'both');
    expect(confirmed.document.nodes[0].point).toEqual(correction.from.point);
    const changed = command('false', null);
    changed.to.point = { x: 0.32, y: 0.48 };
    expect(edit(changed).candidates[0].to.point).toEqual(changed.to.point);
    expect(route().outcome).toBe('no-route');
  });
  it('accepts an explicitly corrected arrival floor and binds to that page instead of aligning floors', () => {
    const correction = command('true', 'both'),
      floor = topologyPlans.find((plan) => plan.id === 'SE12-F4-p1')!;
    correction.to = {
      planId: floor.id,
      sourceSha256: floor.sourceSha256,
      point: { x: 0.33, y: 0.66 },
    };
    const next = edit(correction);
    expect(next.document.nodes[1]).toMatchObject(correction.to);
    expect(next.candidates[0].title).toContain('Floor 4');
    expect(route().outcome).toBe('route');
  });
  it('rejects stale presentations, changed original hashes, unsupported corrections and missing reviewer names', () => {
    const first = command('true', 'both');
    expect(() => edit({ ...first, reviewer: '' })).toThrow('Invalid edit');
    expect(() => edit({ ...first, presentedHash: '0'.repeat(64) })).toThrow('changed');
    expect(() => edit({ ...first, from: { ...first.from, sourceSha256: '0'.repeat(64) } })).toThrow(
      'current official plan',
    );
    const other = topologyPlans.find((plan) => plan.id === 'SW1-F3-p1')!;
    expect(() =>
      edit({
        ...first,
        from: { ...first.from, planId: other.id, sourceSha256: other.sourceSha256 },
      }),
    ).toThrow('same building');
    expect(() => edit({ ...first, from: { ...first.from, point: { x: -1, y: 0.5 } } })).toThrow(
      'Invalid edit',
    );
    const changedCatalog = readConnectionCandidates().map((candidate) => ({
      ...candidate,
      version: candidate.version + 1,
    }));
    const updated = new TopologyStore(file, topologyPlans, changedCatalog);
    expect(() => updated.mutate({ revision: 0, command: first })).toThrow('changed');
    const changedPlans = topologyPlans.map((plan) => ({ ...plan, sourceSha256: 'f'.repeat(64) }));
    const stale = new TopologyStore(file, changedPlans);
    expect(stale.snapshot().candidates[0].blockedReason).not.toBeNull();
    expect(() => stale.mutate({ revision: 0, command: first })).toThrow('source plan');
    expect(store.read().nodes).toEqual([]);
  });
  it('preserves manual corrections, rejects a stale answer and requires re-confirmation after a point moves', () => {
    const initial = answer('true', 'both'),
      node = initial.document.nodes[0],
      oldAnswer = command('true', 'both');
    edit({
      type: 'save-node',
      id: node.id,
      planId: node.planId,
      label: node.label,
      kind: node.kind,
      point: { x: 0.65, y: 0.4 },
      notes: node.notes,
      evidence: node.evidence,
    });
    expect(store.snapshot().candidates[0].from.point).toEqual({ x: 0.65, y: 0.4 });
    expect(store.snapshot().candidates[0].state).toBe('needs-review');
    expect(() => edit(oldAnswer)).toThrow('changed');
    expect(route().outcome).toBe('no-route');
    answer('true', 'both');
    expect(route().outcome).toBe('route');
    expect(store.read().nodes[0].point).toEqual({ x: 0.65, y: 0.4 });
  });
  it('does not reset unrelated approved passages when unchanged candidate points are confirmed again', () => {
    const initial = answer('true', 'both'),
      from = initial.document.nodes[0];
    edit({
      type: 'save-node',
      planId: from.planId,
      label: 'TEST ONLY junction',
      kind: 'junction',
      point: { x: 0.1, y: 0.2 },
      notes: '',
      evidence: { basis: 'plan', note: 'Mock source evidence for tests only.', observedOn: null },
    });
    const another = store.read().nodes.at(-1)!;
    edit({
      type: 'review',
      target: 'node',
      id: another.id,
      status: 'verified',
      reviewer: 'Test',
      note: 'Mock approval.',
    });
    edit({
      type: 'save-edge',
      fromNodeId: from.id,
      toNodeId: another.id,
      kind: 'corridor',
      direction: 'both',
      notes: '',
      distanceMeters: null,
      distanceEvidence: '',
      evidence: another.evidence,
    });
    const edge = store.read().edges.at(-1)!;
    edit({
      type: 'review',
      target: 'edge',
      id: edge.id,
      status: 'verified',
      reviewer: 'Test',
      note: 'Mock approval.',
    });
    expect(answer('true', 'a-to-b').eligibility.edgeIds).toContain(edge.id);
    expect(store.read().nodes.find((node) => node.id === from.id)?.version).toBe(from.version);
  });
  it('does not duplicate answers after a retried revision and retains hash compatibility for earlier approvals', () => {
    const value = command('true', 'both');
    store.mutate({ revision: 0, command: value });
    expect(() => store.mutate({ revision: 0, command: value })).toThrow('Another edit');
    expect(store.read().candidateAnswers).toHaveLength(1);
    expect(topologyContentHash({ a: 1, b: { x: 3, y: 4 } })).toBe(
      topologyContentHash({ b: { y: 4, x: 3 }, a: 1 }),
    );
  });
  it('does not approve a newly edited distance through a candidate answer that only confirms connectivity', () => {
    const initial = answer('true', 'both'),
      edge = initial.document.edges[0];
    edit({
      type: 'save-edge',
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: edge.kind,
      direction: edge.direction,
      notes: edge.notes,
      evidence: edge.evidence,
      distanceMeters: 42,
      distanceEvidence: 'Unreviewed measurement fixture.',
    });
    expect(store.snapshot().eligibility.edgeIds).toEqual([]);
    const confirmed = answer('true', 'both');
    expect(confirmed.document.edges[0].distanceMeters).toBeNull();
    expect(confirmed.document.edges[0].distanceEvidence).toBe('');
    expect(route().distanceMeters).toBeNull();
  });
});

describe('candidate review interface (Node only)', () => {
  it('offers all three answers about service to both floors without inventing marked stops', () => {
    const data = store.snapshot();
    data.candidates = data.candidates.filter(
      (candidate) => candidate.id === 'se12-f2-f3-lift-location',
    );
    const markup = renderToStaticMarkup(
      createElement(ConnectionReview, {
        data,
        reviewer: 'Test',
        busy: false,
        onReviewer: vi.fn(),
        onDirty: vi.fn(),
        onAnswer: vi.fn(),
        onRoute: vi.fn(),
      }),
    );
    expect(markup).toContain('Does an elevator in this building serve both floors?');
    expect(markup).not.toContain('class="candidate-pin');
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>T · Serves both floors/);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>F · No service between floors/);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Unknown · Defer/);
  });
  it('names the mode being reviewed and identifies the permitted direction by floor', () => {
    for (const [id, question] of [
      ['se12-f2-f3-s209-s327', 'Does the same stairway connect A and B?'],
      ['sw3-f2-f3-east-lift', 'Does the same elevator serve both marked landings?'],
    ]) {
      const data = store.snapshot();
      data.candidates = data.candidates.filter((candidate) => candidate.id === id);
      const markup = renderToStaticMarkup(createElement(TopologyEditor, { initialData: data }));
      expect(markup).toContain(question);
      expect(markup).toContain('class="candidate-pin point-a"');
      expect(markup).toContain('class="candidate-pin point-b"');
    }
    const choices = renderToStaticMarkup(
      createElement(DirectionQuestion, {
        disabled: false,
        onAnswer: vi.fn(),
        floorPair: { from: '2', to: '3' },
      }),
    );
    expect(choices).toContain('A → B only (floor 2 → floor 3)');
    expect(choices).toContain('B → A only (floor 3 → floor 2)');
  });
  it('asks about outdoor travel for the second-floor proposal without renumbering it as floor one', () => {
    const data = store.snapshot();
    data.candidates = data.candidates.filter((item) => item.id === 'sw3-se12-floor2-passage');
    const markup = renderToStaticMarkup(createElement(TopologyEditor, { initialData: data }));
    expect(markup).toContain('SW03 · Floor 2');
    expect(markup).toContain('SE12 · Floor 2');
    expect(markup).toContain('Can you walk outside between doors A and B?');
    expect(data.candidates[0].kind).toBe('outdoor');
    expect(data.candidates[0].from.kind).toBe('outdoor-access');
    expect(data.candidates[0].to.kind).toBe('outdoor-access');
    expect(data.document.edges).toEqual([]);
  });
  it('opens on two marked source plans and T/F/unknown answers instead of manual point entry', () => {
    const markup = renderToStaticMarkup(
      createElement(TopologyEditor, { initialData: store.snapshot() }),
    );
    expect(markup).toContain('Review both points and choose T, F or Unknown');
    expect(markup).toContain('T · Connected');
    expect(markup).toContain('F · Disconnected');
    expect(markup).toContain('Unknown · Defer');
    expect(markup).toContain('SW03 · Floor 3');
    expect(markup).toContain('SE12 · Floor 3');
    expect(markup).toContain('Edit A location or floor');
    expect(markup).toContain('Edit B location or floor');
    expect(markup).toContain('Edit map and check routes');
    expect(markup).not.toContain('Add point on plan');
    expect(markup).not.toContain('type="file"');
  });
  it('requires a reviewer identity and presents explicit direction options with no default choice', () => {
    const markup = renderToStaticMarkup(
      createElement(ConnectionReview, {
        data: store.snapshot(),
        reviewer: '',
        busy: false,
        onReviewer: vi.fn(),
        onDirty: vi.fn(),
        onAnswer: vi.fn(),
        onRoute: vi.fn(),
      }),
    );
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>T · Connected/);
    const directions = renderToStaticMarkup(
      createElement(DirectionQuestion, { disabled: false, onAnswer: vi.fn() }),
    );
    for (const label of ['Both directions A ↔ B', 'A → B only', 'B → A only', 'Unknown'])
      expect(directions).toContain(label);
    expect(directions).not.toContain('checked=');
  });
  it('maps detail-view clicks back to original page coordinates and keeps focus bounds on-page', () => {
    expect(
      pointInCandidateView(
        250,
        200,
        { left: 100, top: 100, width: 300, height: 200 },
        [0.2, 0.3, 0.6, 0.7],
      ),
    ).toEqual({ x: 0.4, y: 0.5 });
    expect(
      pointInCandidateView(
        50,
        200,
        { left: 100, top: 100, width: 300, height: 200 },
        [0.2, 0.3, 0.6, 0.7],
      ),
    ).toBeNull();
    expect(candidateFocusBounds(null, false)).toEqual([0, 0, 1, 1]);
    expect(candidateFocusBounds({ x: 1, y: 1 }, false)).toEqual([0.72, 0.64, 1, 1]);
    expect(candidateFocusBounds({ x: 0.2, y: 0.3 }, true)).toEqual([0, 0, 1, 1]);
  });
});

describe('second-to-third-floor reviews', () => {
  it('pairs the seven distinct stair cores on their own plans and places the SW03 lift on the corridor side of its shaft', () => {
    const candidates = store.snapshot().candidates;
    const stairs = candidates.filter((candidate) => candidate.kind === 'stairs');
    expect(
      stairs.map(({ from, to }) => [
        from.planId,
        from.label.split(' · ')[0],
        to.planId,
        to.label.split(' · ')[0],
      ]),
    ).toEqual([
      ['SE12-F2-p1', 'S209', 'SE12-F3-p1', 'S327'],
      ['SE12-F2-p1', 'S200', 'SE12-F3-p1', 'S300'],
      ['SE12-F2-p1', 'S202', 'SE12-F3-p1', 'S313'],
      ['SE12-F2-p1', 'S228', 'SE12-F3-p1', 'S328'],
      ['SW3-F2-p1', 'S260', 'SW3-F3-p1', 'S360'],
      ['SW3-F2-p1', 'S270', 'SW3-F3-p1', 'S370'],
      ['SW3-F2-p1', 'S280', 'SW3-F3-p1', 'S380'],
    ]);
    for (const stair of stairs) {
      expect(stair.from.kind).toBe('stair-landing');
      expect(stair.to.kind).toBe('stair-landing');
      expect(stair.from.point).not.toEqual(stair.to.point);
    }
    const lift = candidates.find(({ id }) => id === 'sw3-f2-f3-east-lift')!;
    const adjacentStair = stairs.find(({ id }) => id === 'sw3-f2-f3-s260-s360')!;
    for (const side of ['from', 'to'] as const) {
      expect(lift[side].kind).toBe('elevator-stop');
      expect(lift[side].point!.x).toBeLessThan(adjacentStair[side].point!.x);
      expect(lift[side].point!.y).toBeLessThan(adjacentStair[side].point!.y);
    }
    expect(lift.supportingSource?.url).toBe(
      'https://www.bcit.ca/files/maps/pdf/bby_access_map.pdf',
    );
  });
  it.each([
    ['se12-f2-f3-s209-s327', 'stairs'],
    ['sw3-f2-f3-east-lift', 'elevator'],
  ])('routes %s only in the direction confirmed', (id, kind) => {
    const draft = edit(command('true', 'unknown', id));
    expect(draft.eligibility.edgeIds).toEqual([]);
    const saved = edit(command('true', 'b-to-a', id));
    expect(saved.document.edges[0]).toMatchObject({
      kind,
      direction: 'forward',
      distanceMeters: null,
      evidence: { basis: 'user-confirmation', observedOn: null },
    });
    expect(route().outcome).toBe('no-route');
    expect(route(true).outcome).toBe('route');
    const invalid = command('true', 'both', id);
    invalid.to = { ...invalid.from };
    expect(() => edit(invalid)).toThrow('different floors');
    expect(store.read().revision).toBe(saved.document.revision);
    expect(edit(command('false', null, id)).eligibility.edgeIds).toEqual([]);
  });
  it('retains floor-only observations while requiring two user-located elevator stops before creating any graph records', () => {
    const id = 'se12-f2-f3-lift-location';
    const inquiry = () => store.snapshot().candidates.find((item) => item.id === id)!;
    const fields = () => {
      const view = inquiry();
      const position = (side: 'from' | 'to') => {
        const { planId, sourceSha256, point } = view[side];
        return { planId, sourceSha256, point };
      };
      return {
        candidateId: id,
        presentedHash: view.presentedHash,
        from: position('from'),
        to: position('to'),
        reviewer: 'Mock',
        note: 'Test only',
      };
    };
    const initial = fields();
    for (const answer of ['false', 'unknown', 'true'] as const) {
      const observation = { type: 'record-floor-observation' as const, ...fields(), answer };
      const result = edit(observation);
      expect(result.document.candidateAnswers).toEqual([]);
      expect(result.document.nodes).toEqual([]);
      expect(result.document.edges).toEqual([]);
      expect(inquiry().state).toBe(
        ({ false: 'rejected', unknown: 'deferred', true: 'needs-points' } as const)[answer],
      );
    }
    expect(() => edit({ ...initial, type: 'record-floor-observation', answer: 'false' })).toThrow(
      'changed',
    );
    const corrected = fields();
    const confirmed = edit({
      ...corrected,
      from: { ...corrected.from, point: { x: 0.24, y: 0.4 } },
      to: { ...corrected.to, point: { x: 0.52, y: 0.7 } },
      type: 'answer-candidate',
      answer: 'true',
      direction: 'both',
    });
    expect(confirmed.document.candidateAnswers).toHaveLength(1);
    expect(confirmed.document.floorObservations).toHaveLength(3);
    expect(route(true).outcome).toBe('route');
    expect(
      new TopologyStore(file).snapshot().candidates.find((item) => item.id === id)
        ?.allowsFloorOnlyAnswer,
    ).toBe(false);
    expect(() => edit({ ...fields(), type: 'record-floor-observation', answer: 'false' })).toThrow(
      'marked points',
    );
  });
});

it('handles a floor-number correction without transferring old pins or deleting past confirmations', () => {
  const third = answer('true', 'both');
  const thirdEdge = third.document.edges[0].id;
  const fourth = edit(command('true', 'both', 'sw3-se12-floor4-passage'));
  const binding = fourth.document.candidateAnswers.at(-1)!.bindings!;
  const history = structuredClone(fourth.document.candidateAnswers);
  const fourthPositions = fourth.document.nodes
    .filter((node) => [binding.fromNodeId, binding.toNodeId].includes(node.id))
    .map((node) => ({ id: node.id, planId: node.planId, point: node.point }));
  for (const [target, id] of [
    ['node', binding.fromNodeId],
    ['node', binding.toNodeId],
    ['edge', binding.edgeId],
  ] as const) {
    edit({
      type: 'review',
      target,
      id,
      status: 'draft',
      reviewer: 'Correction fixture',
      note: 'Earlier floor-four confirmation is withdrawn pending clarification.',
    });
  }
  const corrected = store.snapshot();
  expect(corrected.eligibility.edgeIds).toEqual([thirdEdge]);
  expect(corrected.document.candidateAnswers).toEqual(history);
  expect(corrected.candidates.find((item) => item.id === 'sw3-se12-floor4-passage')?.state).toBe(
    'needs-review',
  );
  expect(corrected.candidates.find((item) => item.id === 'sw3-se12-floor2-passage')?.state).toBe(
    'unanswered',
  );
  const second = edit(command('true', 'both', 'sw3-se12-floor2-passage'));
  const outside = second.document.edges.at(-1)!;
  expect(outside.kind).toBe('outdoor');
  expect(outside.direction).toBe('both');
  expect(outside.distanceMeters).toBeNull();
  expect(second.document.nodes.find((node) => node.id === outside.fromNodeId)?.planId).toBe(
    'SW3-F2-p1',
  );
  expect(second.document.nodes.find((node) => node.id === outside.toNodeId)?.planId).toBe(
    'SE12-F2-p1',
  );
  expect(
    second.document.nodes
      .filter((node) => [binding.fromNodeId, binding.toNodeId].includes(node.id))
      .map((node) => ({ id: node.id, planId: node.planId, point: node.point })),
  ).toEqual(fourthPositions);
  expect(second.eligibility.edgeIds).toContain(thirdEdge);
  expect(second.eligibility.edgeIds).not.toContain(binding.edgeId);
});
