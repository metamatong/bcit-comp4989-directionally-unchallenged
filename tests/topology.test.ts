import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  TopologyStore,
  topologyEligibility,
  topologyPlans,
  validateTopologyDocument,
} from '../server/topology';
import { computeTopologyRoute } from '../server/routing';
import { isLocalTopologyRequest } from '../server/topology-api';
import {
  pointOnPlan,
  type TopologyCommand,
  type TopologyNode,
  type TopologyEdge,
} from '../src/topology';

// Artificial annotation fixtures exercise contracts only. They are never saved in campus data.
const seed = { schemaVersion: 1, revision: 0, updatedAt: null, nodes: [], edges: [] };
let directory: string, file: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'campuslens-topology-'));
  file = join(directory, 'topology.json');
  writeFileSync(file, JSON.stringify(seed));
  store = new TopologyStore(file);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const evidence = () => ({
  basis: 'plan' as const,
  note: 'Mock annotation evidence for a regression test only.',
  observedOn: null,
});
function edit(command: TopologyCommand) {
  return store.mutate({ revision: store.read().revision, command });
}
function point(
  label: string,
  overrides: Partial<Extract<TopologyCommand, { type: 'save-node' }>> = {},
) {
  return edit({
    type: 'save-node',
    planId: 'SE12-F3-p1',
    label,
    kind: 'door',
    point: { x: 0.3, y: 0.4 },
    notes: '',
    evidence: evidence(),
    ...overrides,
  }).document.nodes.at(-1)!;
}
function connection(
  from: TopologyNode,
  to: TopologyNode,
  overrides: Partial<Extract<TopologyCommand, { type: 'save-edge' }>> = {},
) {
  return edit({
    type: 'save-edge',
    fromNodeId: from.id,
    toNodeId: to.id,
    kind: 'corridor',
    direction: 'both',
    notes: '',
    evidence: evidence(),
    distanceMeters: null,
    distanceEvidence: '',
    ...overrides,
  }).document.edges.at(-1)!;
}
function review(
  target: 'node' | 'edge',
  id: string,
  status: 'verified' | 'rejected' | 'draft' = 'verified',
) {
  return edit({
    type: 'review',
    target,
    id,
    status,
    reviewer: 'Test reviewer',
    note: 'Mock review decision for this test only.',
  });
}
function route(
  from: TopologyNode,
  to: TopologyNode,
  mode: 'fewest-connections' | 'measured-distance' = 'fewest-connections',
) {
  const document = store.read();
  return computeTopologyRoute(document, {
    revision: document.revision,
    fromNodeId: from.id,
    toNodeId: to.id,
    mode,
  });
}
function resavePoint(
  node: TopologyNode,
  changes: { label?: string; point?: { x: number; y: number } } = {},
) {
  const { id, planId, label, kind, point: coordinates, notes, evidence } = node;
  return edit({
    type: 'save-node',
    id,
    planId,
    label,
    kind,
    point: coordinates,
    notes,
    evidence,
    ...changes,
  });
}
function resaveEdge(edge: TopologyEdge, changes: { notes?: string } = {}) {
  const {
    id,
    fromNodeId,
    toNodeId,
    kind,
    direction,
    notes,
    evidence,
    distanceMeters,
    distanceEvidence,
  } = edge;
  return edit({
    type: 'save-edge',
    id,
    fromNodeId,
    toNodeId,
    kind,
    direction,
    notes,
    evidence,
    distanceMeters,
    distanceEvidence,
    ...changes,
  });
}
describe('persistent human-reviewed topology', () => {
  it('starts empty with exactly the twelve pilot plans and binds point coordinates to original source hashes', () => {
    const initial = store.snapshot();
    expect(initial.plans).toHaveLength(12);
    expect(new Set(initial.plans.map((plan) => plan.building))).toEqual(
      new Set(['SE12', 'SW3', 'SW1']),
    );
    expect(initial.document.nodes).toEqual([]);
    const node = point('0302A');
    expect(node.label).toBe('0302A');
    expect(node.sourceSha256).toBe(
      topologyPlans.find((plan) => plan.id === node.planId)!.sourceSha256,
    );
    expect(node.point).toEqual({ x: 0.3, y: 0.4 });
    expect(new TopologyStore(file).read()).toEqual(store.read());
    expect(node.review).toBeNull();
  });
  it('requires evidence and both approved endpoints before a connection can enter the route graph', () => {
    const from = point('fixture A', { evidence: { ...evidence(), note: '' } });
    const to = point('fixture B');
    const edge = connection(from, to);
    expect(() => review('node', from.id)).toThrow('evidence note');
    expect(() => review('edge', edge.id)).toThrow('both endpoint');
    expect(route(from, to).outcome).toBe('no-route');
    edit({
      type: 'save-node',
      id: from.id,
      planId: from.planId,
      label: from.label,
      kind: from.kind,
      point: from.point,
      notes: '',
      evidence: evidence(),
    });
    review('node', from.id);
    review('node', to.id);
    expect(route(from, to).outcome).toBe('no-route');
    review('edge', edge.id);
    expect(route(from, to)).toMatchObject({
      outcome: 'route',
      edgeIds: [edge.id],
      distanceMeters: null,
    });
  });
  it('invalidates connected approvals after a point moves and preserves historical evidence', () => {
    const from = point('fixture A'),
      to = point('fixture B'),
      edge = connection(from, to);
    review('node', from.id);
    review('node', to.id);
    review('edge', edge.id);
    const updated = resavePoint(from, { point: { x: 0.7, y: 0.6 } });
    expect(updated.document.nodes[0].review).toBeNull();
    expect(updated.document.edges[0].review).toBeNull();
    expect(updated.document.edges[0].reviewHistory[0].evidence.note).toContain('Mock annotation');
    review('node', from.id);
    expect(route(from, to).outcome).toBe('no-route');
    review('edge', edge.id);
    expect(route(from, to).outcome).toBe('route');
  });
  it('requires re-review after changing a connection or withdrawing an endpoint approval', () => {
    const from = point('fixture A'),
      to = point('fixture B'),
      edge = connection(from, to);
    review('node', from.id);
    review('node', to.id);
    review('edge', edge.id);
    resaveEdge(edge, { notes: 'Changed passage information.' });
    expect(route(from, to).outcome).toBe('no-route');
    review('edge', edge.id);
    review('node', to.id, 'rejected');
    review('node', to.id);
    expect(route(from, to).outcome).toBe('no-route');
    review('edge', edge.id);
    expect(route(from, to).outcome).toBe('route');
  });
  it('excludes stale sources and records whose approved content has been altered', () => {
    const from = point('fixture A'),
      to = point('fixture B'),
      edge = connection(from, to);
    review('node', from.id);
    review('node', to.id);
    review('edge', edge.id);
    const modified = store.read();
    modified.nodes[0].point.x = 0.99;
    expect(topologyEligibility(modified).edgeIds).toEqual([]);
    const changedSources = topologyPlans.map((plan) => ({ ...plan, sourceSha256: 'f'.repeat(64) }));
    expect(topologyEligibility(store.read(), changedSources).edgeIds).toEqual([]);
    const refreshedStore = new TopologyStore(file, changedSources);
    expect(() =>
      refreshedStore.mutate({
        revision: store.read().revision,
        command: {
          type: 'review',
          target: 'node',
          id: from.id,
          status: 'verified',
          reviewer: 'Tester',
          note: 'Recheck source',
        },
      }),
    ).toThrow('source changed');
  });
  it('rejects stale concurrent writes without losing the first edit', () => {
    const initialRevision = store.read().revision;
    point('fixture A');
    const before = readFileSync(file, 'utf8');
    expect(() =>
      new TopologyStore(file).mutate({
        revision: initialRevision,
        command: { type: 'delete-node', id: store.read().nodes[0].id },
      }),
    ).toThrow('Another edit');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
  it('rejects a competing writer lock and never resets invalid or missing storage', () => {
    writeFileSync(`${file}.lock`, '');
    expect(() => point('fixture A')).toThrow('busy');
    rmSync(`${file}.lock`);
    writeFileSync(file, '{broken');
    expect(() => store.snapshot()).toThrow('not reset');
    expect(readFileSync(file, 'utf8')).toBe('{broken');
    rmSync(file);
    expect(() => store.read()).toThrow('not reset');
  });
  it('deletes a point and all its incident connections without leaving dangling routes', () => {
    const from = point('fixture A'),
      to = point('fixture B');
    connection(from, to);
    const next = edit({ type: 'delete-node', id: from.id });
    expect(next.document.nodes.map((node) => node.id)).toEqual([to.id]);
    expect(next.document.edges).toEqual([]);
  });
  it('rejects unsupported plans, out-of-page coordinates and injected review fields', () => {
    expect(() => point('fixture A', { planId: 'NE1-F1-p1' })).toThrow('official');
    expect(() => point('fixture A', { point: { x: 1.1, y: 0.5 } })).toThrow('Invalid edit');
    expect(() =>
      store.mutate({
        revision: 0,
        command: {
          type: 'save-node',
          planId: 'SE12-F3-p1',
          label: 'A',
          kind: 'door',
          point: { x: 0.2, y: 0.2 },
          notes: '',
          evidence: evidence(),
          review: { status: 'verified' },
        },
      }),
    ).toThrow('Invalid edit');
    expect(store.read().nodes).toEqual([]);
  });
  it('validates transition semantics without assuming floors are aligned or all landings connect', () => {
    const lower = point('fixture lower', { kind: 'stair-landing' });
    const upper = point('fixture upper', { planId: 'SE12-F4-p1', kind: 'stair-landing' });
    expect(() => connection(lower, upper)).toThrow('one plan');
    const stair = connection(lower, upper, { kind: 'stairs' });
    review('node', lower.id);
    review('node', upper.id);
    expect(route(lower, upper).outcome).toBe('no-route');
    review('edge', stair.id);
    expect(route(lower, upper).edgeIds).toEqual([stair.id]);
    const otherBuilding = point('fixture other building', { planId: 'SW3-F2-p1' });
    expect(() => connection(upper, otherBuilding, { kind: 'stairs' })).toThrow('stair-landing');
    const link = connection(upper, otherBuilding, { kind: 'building-link' });
    review('node', otherBuilding.id);
    review('edge', link.id);
    expect(route(upper, otherBuilding).edgeIds).toEqual([link.id]);
  });
  it('requires real elevator stops and dated field evidence for outdoor passages', () => {
    const a = point('fixture A'),
      b = point('fixture B', { planId: 'SE12-F4-p1' });
    expect(() => connection(a, b, { kind: 'elevator' })).toThrow('elevator-stop');
    const outsideA = point('fixture outside A', { kind: 'outdoor-access' });
    const outsideB = point('fixture outside B', { kind: 'outdoor-access', planId: 'SW1-F1-p1' });
    const edge = connection(outsideA, outsideB, { kind: 'outdoor' });
    review('node', outsideA.id);
    review('node', outsideB.id);
    expect(() => review('edge', edge.id)).toThrow('dated field');
    const missingDate = point('fixture field point', {
      evidence: { ...evidence(), basis: 'field' },
    });
    expect(() => review('node', missingDate.id)).toThrow('date');
  });
  it('rejects duplicate IDs and dangling or self connections in a stored document', () => {
    const a = point('fixture A'),
      b = point('fixture B');
    connection(a, b);
    const document = store.read();
    expect(() =>
      validateTopologyDocument({ ...document, nodes: [...document.nodes, document.nodes[0]] }),
    ).toThrow('unique');
    expect(() =>
      validateTopologyDocument({
        ...document,
        edges: [{ ...document.edges[0], toNodeId: randomUUID() }],
      }),
    ).toThrow('two different');
    expect(() => connection(a, a)).toThrow('two different');
  });
});

describe('routing only over eligible evidence', () => {
  it('ignores draft and rejected shortcuts and returns directionally valid edge IDs', () => {
    const a = point('fixture A'),
      b = point('fixture B'),
      c = point('fixture C');
    const ab = connection(a, b, { direction: 'forward' }),
      bc = connection(b, c, { direction: 'forward' });
    const shortcut = connection(a, c);
    for (const node of [a, b, c]) review('node', node.id);
    review('edge', ab.id);
    review('edge', bc.id);
    expect(route(a, c).edgeIds).toEqual([ab.id, bc.id]);
    review('edge', shortcut.id, 'rejected');
    expect(route(a, c).edgeIds).toEqual([ab.id, bc.id]);
    expect(route(c, a).outcome).toBe('no-route');
    review('edge', shortcut.id);
    expect(route(a, c).edgeIds).toEqual([shortcut.id]);
  });
  it('uses measured costs only when requested and never defaults unknown distances to one metre', () => {
    const a = point('fixture A'),
      b = point('fixture B'),
      c = point('fixture C');
    const measurement = 'Mock tape measurement for algorithm validation only.';
    const ab = connection(a, b, { distanceMeters: 4, distanceEvidence: measurement });
    const bc = connection(b, c, { distanceMeters: 6, distanceEvidence: measurement });
    const ac = connection(a, c, { distanceMeters: 30, distanceEvidence: measurement });
    for (const node of [a, b, c]) review('node', node.id);
    for (const edge of [ab, bc, ac]) review('edge', edge.id);
    expect(route(a, c).edgeIds).toEqual([ac.id]);
    expect(route(a, c, 'measured-distance')).toMatchObject({
      edgeIds: [ab.id, bc.id],
      distanceMeters: 10,
    });
    const d = point('fixture D');
    review('node', d.id);
    const cd = connection(c, d);
    review('edge', cd.id);
    expect(route(a, d).outcome).toBe('route');
    expect(route(a, d, 'measured-distance').outcome).toBe('no-route');
  });
  it('requires measurement evidence and rejects stale route requests and unknown points', () => {
    const a = point('fixture A'),
      b = point('fixture B');
    const edge = connection(a, b, { distanceMeters: 1 });
    review('node', a.id);
    review('node', b.id);
    expect(() => review('edge', edge.id)).toThrow('measured');
    const document = store.read();
    expect(() =>
      computeTopologyRoute(document, {
        revision: 0,
        fromNodeId: a.id,
        toNodeId: b.id,
        mode: 'fewest-connections',
      }),
    ).toThrow('graph changed');
    expect(() =>
      computeTopologyRoute(document, {
        revision: document.revision,
        fromNodeId: a.id,
        toNodeId: randomUUID(),
        mode: 'fewest-connections',
      }),
    ).toThrow('saved route');
    expect(route(a, a)).toMatchObject({
      outcome: 'route',
      nodeIds: [a.id],
      edgeIds: [],
      distanceMeters: 0,
    });
  });
});

describe('annotation coordinates and internal access', () => {
  it('preserves the same page position under zoom and rejects clicks outside the page', () => {
    expect(pointOnPlan(300, 250, { left: 100, top: 50, width: 800, height: 400 })).toEqual({
      x: 0.25,
      y: 0.5,
    });
    expect(pointOnPlan(500, 450, { left: 100, top: 50, width: 1600, height: 800 })).toEqual({
      x: 0.25,
      y: 0.5,
    });
    expect(pointOnPlan(50, 50, { left: 100, top: 50, width: 800, height: 400 })).toBeNull();
    expect(pointOnPlan(50, 50, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
  it('requires both a loopback connection and a local Host header', () => {
    expect(isLocalTopologyRequest('127.0.0.1', '127.0.0.1:3000')).toBe(true);
    expect(isLocalTopologyRequest('::1', '[::1]:3000')).toBe(true);
    expect(isLocalTopologyRequest('::ffff:127.0.0.1', 'localhost:3000')).toBe(true);
    expect(isLocalTopologyRequest('192.168.1.2', 'localhost:3000')).toBe(false);
    expect(isLocalTopologyRequest('127.0.0.1', 'attacker.example')).toBe(false);
    expect(isLocalTopologyRequest('127.0.0.1', 'localhost@attacker.example')).toBe(false);
  });
});
