import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { reviewedNetwork } from '../server/pilot-network';
import { readConnectionCandidates } from '../server/topology-candidates';
import { importReviewedNetwork } from '../server/topology-import';
import { topologyContentHash, topologyRecordHash } from '../server/topology-provenance';
import { TopologyStore } from '../server/topology';
import { readJson } from '../server/data';
import { visitorPassages } from '../server/visitor-paths';
import { pilotEvidence } from '../server/pilot-evidence';
import { planVisitorJourney } from '../server/wayfinding';
import type { CampusLocationCandidate } from '../src/types';

const candidates = readConnectionCandidates();
const translations = readJson<{ definitionHashes: Record<string, string> }>(
  'data/campus/topology-english-migration.json',
);
const previousHashes = new Map(
  Object.entries(translations.definitionHashes).map(([old, current]) => [current, old]),
);
let directory: string;
let file: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'english-topology-'));
  file = join(directory, 'topology.json');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function legacyJournal() {
  const document = importReviewedNetwork(reviewedNetwork(), candidates, '2026-11-13T12:00:00.000Z');
  document.schemaVersion = 1;
  for (const receipt of [...document.candidateAnswers, ...document.floorObservations]) {
    const original = previousHashes.get(receipt.definitionHash);
    if (!original) throw Error('Missing translation for a published candidate');
    receipt.definitionHash = original;
  }
  return document;
}

it('upgrades a saved journal once and retains the exact directions, history and mapped doors', () => {
  const original = legacyJournal();
  const answer = original.candidateAnswers.find(
    (a) => a.candidateId === 'se12-f3-302-to-sw03-link',
  )!;
  const node = original.nodes.find((n) => n.id === answer.bindings!.fromNodeId)!;
  const edge = original.edges.find((e) => e.id === answer.bindings!.edgeId)!;
  // A custom annotation has an explicit translation, while other user-entered notes retain their wording.
  const custom = '302 · ' + String.fromCodePoint(0xd55c);
  node.label = custom;
  node.review!.contentHash = topologyRecordHash(node);
  node.reviewHistory = [structuredClone(node.review!)];
  const oldNodeHash = node.review!.contentHash;
  edge.direction = 'forward';
  answer.direction = 'a-to-b';
  edge.notes = custom;
  edge.review!.contentHash = topologyRecordHash(edge);
  edge.reviewHistory = [structuredClone(edge.review!)];
  answer.bindings!.reviewedEdgeHash = edge.review!.contentHash;
  answer.from.label = custom;
  answer.note = 'Original reviewer note.';
  writeFileSync(file, JSON.stringify(original));
  const store = new TopologyStore(
    file,
    undefined,
    candidates,
    undefined,
    new Map([[custom, '302 · window-side corridor door']]),
  );
  const { document, eligibility } = store.snapshot();
  expect(document).toMatchObject({
    schemaVersion: 2,
    revision: original.revision + 1,
    updatedAt: original.updatedAt,
  });
  const savedNode = document.nodes.find((n) => n.id === node.id)!;
  expect(savedNode).toMatchObject({
    label: '302 · window-side corridor door',
    point: node.point,
    version: node.version,
    review: { legacyContentHash: oldNodeHash },
  });
  expect(savedNode.review!.contentHash).toBe(topologyRecordHash(savedNode));
  const savedEdge = document.edges.find((e) => e.id === edge.id)!;
  const savedAnswer = document.candidateAnswers.find((a) => a.id === answer.id)!;
  expect(savedAnswer).toMatchObject({
    note: answer.note,
    reviewer: answer.reviewer,
    direction: 'a-to-b',
    answeredAt: answer.answeredAt,
    presentedHash: answer.presentedHash,
    bindings: { reviewedEdgeHash: topologyRecordHash(savedEdge) },
  });
  expect(savedEdge.direction).toBe('forward');
  expect(document.candidateAnswers.map((a) => a.id)).toEqual(
    original.candidateAnswers.map((a) => a.id),
  );
  expect(eligibility.nodeIds).toHaveLength(24);
  expect(eligibility.edgeIds).toHaveLength(16);
  const network = visitorPassages(document, eligibility, candidates, store.plans);
  expect(network.traces.size).toBe(6);
  expect(network.doors.size).toBe(4);
  const page = pilotEvidence().find((p) => p.plan.id === savedNode.planId)!;
  const door = page.drawnDoors.find((d) => d.room === '302')!;
  const start: CampusLocationCandidate = {
    id: savedNode.id,
    planId: savedNode.planId,
    page: page.plan.page,
    floor: page.plan.floor,
    building: page.plan.building,
    sourceRef: page.plan.sourceRef,
    bounds: door.corridorBounds!,
    confidence: 'low',
    limitations: [],
    matches: [],
    labelMatches: [],
    verification: 'unverified-ai-hypothesis',
    doorwayVicinity: {
      room: door.room,
      doorId: door.id,
      point: door.point,
      sourceSha256: page.plan.sourceSha256,
    },
  };
  const route = planVisitorJourney(
    start,
    {
      revision: 1,
      candidateId: start.id,
      destination: 'SW03 2605',
      originId: savedNode.id,
      networkRevision: document.revision,
    },
    store,
  );
  if (route.status !== 'route') throw Error('Missing route from 302 to 2605 after upgrading');
  expect(route.steps.map((step) => step.kind)).toEqual([
    'corridor',
    'building-link',
    'corridor',
    'elevator',
    'corridor',
  ]);
  expect(route.destination.label).toBe('2605 · 2600 corridor door');
  expect(JSON.stringify(route)).not.toMatch(/\p{Script=Hangul}/u);
  const bytes = readFileSync(file);
  expect(new TopologyStore(file).read()).toEqual(document);
  expect(readFileSync(file)).toEqual(bytes);
});

it('keeps stale approvals, withdrawn passages and changed candidate definitions out of the route', () => {
  const document = legacyJournal();
  const [stale, revoked, changed] = [
    'sw3-f2-east-lift-to-2605',
    'sw3-f3-east-lift-to-3615',
    'se12-f3-302-to-sw03-link',
  ].map((id) => document.candidateAnswers.find((a) => a.candidateId === id)!);
  const edge = document.edges.find((e) => e.id === stale.bindings!.edgeId)!;
  edge.notes += ' An unreviewed edit.';
  revoked.answer = 'false';
  revoked.direction = null;
  changed.definitionHash = '0'.repeat(64);
  writeFileSync(file, JSON.stringify(document));
  const store = new TopologyStore(file);
  const data = store.snapshot();
  const network = visitorPassages(data.document, data.eligibility, candidates, store.plans);
  expect(data.eligibility.edgeIds).not.toContain(edge.id);
  expect(data.eligibility.edgeIds).not.toContain(revoked.bindings!.edgeId);
  expect(network.allowed.has(changed.bindings!.edgeId)).toBe(false);
  expect(data.candidates.find((c) => c.id === changed.candidateId)?.definitionHash).not.toBe(
    changed.definitionHash,
  );
});

it('ships English map and review text and binds every prior definition to its specific translation', () => {
  const source = reviewedNetwork();
  expect(JSON.stringify([candidates, source])).not.toMatch(/\p{Script=Hangul}/u);
  expect(new Set(Object.values(translations.definitionHashes))).toEqual(
    new Set(candidates.map((c) => topologyContentHash(c))),
  );
  expect(
    source.nodes.find((n) => n.kind === 'elevator-stop' && n.planId === 'SW3-F3-p1')?.label,
  ).toBe('East elevator at 3696 · corridor 3600');
});
