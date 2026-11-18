/** Reviewed crossings and vertical transfers retain independent source positions and shared landing identities. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { computeTopologyRoute } from '../server/routing';
import { visitorPassages } from '../server/visitor-paths';
import { planVisitorNavigation } from '../server/wayfinding';
import { photoStartFixture } from './wayfinding-fixtures';

let directory: string;
let store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fourth-floor-passage-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function crossing() {
  const snapshot = store.snapshot();
  const candidate = snapshot.candidates.find((item) => item.id === 'sw3-se12-floor4-passage')!;
  const bindings = candidate.latestAnswer!.bindings!;
  const passages = visitorPassages(
    snapshot.document,
    snapshot.eligibility,
    store.candidates,
    store.plans,
  );
  return { ...snapshot, candidate, bindings, passages };
}

/** Reconstruct the pre-confirmation state only inside this isolated fixture. */
function pendingVerticalReviews() {
  const snapshot = structuredClone(reviewedNetwork());
  const verticalIds = new Set(['sw3-f3-f4-east-lift', 'sw3-f3-f4-s360-s460']);
  const pendingEdges = snapshot.edges.filter((edge) =>
    verticalIds.has(edge.sourceCandidateId ?? ''),
  );
  const fourthFloorNodes = new Set(pendingEdges.map((edge) => edge.toNodeId));
  snapshot.edges = snapshot.edges.filter((edge) => !pendingEdges.includes(edge));
  snapshot.nodes = snapshot.nodes.filter((node) => !fourthFloorNodes.has(node.id));
  store = new TopologyStore(join(directory, 'pending.json'), undefined, undefined, () => snapshot);
}

it.each([
  ['sw3-f3-f4-east-lift', 'sw3-f2-f3-east-lift'],
  ['sw3-f3-f4-s360-s460', 'sw3-f2-f3-s260-s360'],
])('keeps %s pending while reusing its reviewed floor-three landing', (id, ownerId) => {
  pendingVerticalReviews();
  const before = store.read();
  const data = store.snapshot();
  const proposal = data.candidates.find((candidate) => candidate.id === id)!;
  const owner = data.candidates.find((candidate) => candidate.id === ownerId)!.latestAnswer!
    .bindings!;
  expect(proposal.state).toBe('unanswered');
  expect(proposal.latestAnswer).toBeNull();
  expect(proposal.sharedEndpoints!.from!.id).toBe(owner.toNodeId);
  expect(proposal.sharedEndpoints!.to).toBeNull();
  expect(proposal.waitingForPoints).toBe(false);
  expect(store.read()).toEqual(before);
});

it.each(['sw3-f3-f4-east-lift', 'sw3-f3-f4-s360-s460'])(
  'reuses the floor-three node when %s is confirmed in an isolated test only',
  (id) => {
    pendingVerticalReviews();
    const before = store.snapshot();
    const candidate = before.candidates.find((item) => item.id === id)!;
    const position = (side: 'from' | 'to') => ({
      planId: candidate[side].planId,
      sourceSha256: candidate[side].sourceSha256,
      point: candidate[side].point,
    });
    const after = store.mutate({
      revision: before.document.revision,
      command: {
        type: 'answer-candidate',
        candidateId: id,
        presentedHash: candidate.presentedHash,
        from: position('from'),
        to: position('to'),
        answer: 'true',
        direction: 'both',
        reviewer: 'Mocked regression',
        note: 'Temporary fixture only; not a real review.',
      },
    });
    const receipt = after.document.candidateAnswers.at(-1)!.bindings!;
    expect(receipt.fromNodeId).toBe(candidate.sharedEndpoints!.from!.id);
    expect(after.document.nodes).toHaveLength(before.document.nodes.length + 1);
    expect(after.document.edges).toHaveLength(before.document.edges.length + 1);
  },
);

it.each([false, true])('uses the corrected fourth-floor passage with reverse=%s', (reverse) => {
  const { document, candidate, bindings, passages } = crossing();
  expect(candidate.state).toBe('confirmed');
  expect(candidate.latestAnswer!.direction).toBe('both');
  expect(candidate.from).toMatchObject({ planId: 'SW3-F4-p1', point: { x: 0.77, y: 0.585 } });
  expect(candidate.to).toMatchObject({ planId: 'SE12-F4-p1', point: { x: 0.44, y: 0.673 } });
  const fromNodeId = reverse ? bindings.toNodeId : bindings.fromNodeId;
  const toNodeId = reverse ? bindings.fromNodeId : bindings.toNodeId;
  const result = computeTopologyRoute(
    document,
    {
      revision: document.revision,
      fromNodeId,
      toNodeId,
      mode: 'fewest-connections',
    },
    store.plans,
    passages.allowed,
  );
  expect(result.outcome).toBe('route');
  expect(result.edgeIds).toEqual([bindings.edgeId]);
  expect(result.nodeIds).toEqual([fromNodeId, toNodeId]);
  expect(document.nodes.find((node) => node.id === bindings.fromNodeId)!.point).not.toEqual({
    x: 0.4875,
    y: 0.298,
  });
  // Floor three's coordinate must not be copied onto the independently drawn fourth floor.
  expect(candidate.from.point).not.toEqual({ x: 0.77, y: 0.6325758 });
});

it('rejects the superseded fourth-floor endpoint receipt', () => {
  const before = crossing();
  before.candidate.latestAnswer!.definitionHash =
    '594dea96570cc4c426d8d29fcc4ce5d8aeb72bfdf71504db185b3cdf1db4b85c';
  const receipt = before.document.candidateAnswers.find(
    (item) => item.candidateId === before.candidate.id,
  )!;
  receipt.definitionHash = before.candidate.latestAnswer!.definitionHash;
  writeFileSync(store.file, JSON.stringify(before.document));
  const { document, bindings, passages } = crossing();
  expect(passages.allowed.has(bindings.edgeId)).toBe(false);
  const result = computeTopologyRoute(
    document,
    {
      revision: document.revision,
      fromNodeId: bindings.fromNodeId,
      toNodeId: bindings.toNodeId,
      mode: 'fewest-connections',
    },
    store.plans,
    passages.allowed,
  );
  expect(result.outcome).toBe('no-route');
});

it('does not infer an unreviewed corridor from the fourth-floor entrance to the vertical landings', () => {
  const { document, bindings, passages } = crossing();
  const thirdFloor = document.nodes.find(
    (node) => node.planId === 'SW3-F3-p1' && node.kind === 'elevator-stop',
  )!;
  const result = computeTopologyRoute(
    document,
    {
      revision: document.revision,
      fromNodeId: bindings.fromNodeId,
      toNodeId: thirdFloor.id,
      mode: 'fewest-connections',
    },
    store.plans,
    passages.allowed,
  );
  expect(result.outcome).toBe('no-route');
});

it.each(['sw3-f3-f4-east-lift', 'sw3-f3-f4-s360-s460'])(
  'publishes the confirmed %s transfer in both directions',
  (id) => {
    const data = store.snapshot();
    const candidate = data.candidates.find((item) => item.id === id)!;
    const binding = candidate.latestAnswer!.bindings!;
    expect(candidate.state).toBe('confirmed');
    expect(candidate.latestAnswer!.direction).toBe('both');
    const allowed = visitorPassages(
      data.document,
      data.eligibility,
      store.candidates,
      store.plans,
    ).allowed;
    for (const reverse of [false, true]) {
      const result = computeTopologyRoute(
        data.document,
        {
          revision: data.document.revision,
          fromNodeId: reverse ? binding.toNodeId : binding.fromNodeId,
          toNodeId: reverse ? binding.fromNodeId : binding.toNodeId,
          mode: 'fewest-connections',
        },
        store.plans,
        allowed,
      );
      expect(result.outcome).toBe('route');
      expect(result.edgeIds).toEqual([binding.edgeId]);
    }
  },
);

it('reaches the fourth-floor elevator from the mapped SE12 302 start', async () => {
  const candidate = photoStartFixture();
  const result = await planVisitorNavigation(
    candidate,
    {
      revision: 1,
      candidateId: candidate.id,
      destination: 'SW03 floor 4 elevator',
    },
    store,
  );
  if (result.status !== 'route') throw Error('Missing the confirmed fourth-floor elevator route');
  expect(result.steps.map((step) => step.kind)).toEqual([
    'corridor',
    'building-link',
    'corridor',
    'elevator',
  ]);
  expect(result.destination).toMatchObject({
    planId: 'SW3-F4-p1',
    point: { x: 0.7401961, y: 0.5929293 },
  });
});
