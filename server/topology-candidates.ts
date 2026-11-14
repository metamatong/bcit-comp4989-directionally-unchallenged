import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { VisualPlan } from '../src/types';
import { visualPlans } from './visual-data';
import {
  connectionCandidateSchema,
  planLabel,
  type CandidateEndpoint,
  type CandidateView,
  type ConnectionCandidate,
  type TopologyDocument,
  type TopologyEligibility,
} from '../src/topology';
import { root } from './data';
import { topologyContentHash } from './topology-provenance';
import type { CandidateAnswer, FloorObservation } from '../src/topology';

function reviewState(
  answer: CandidateAnswer | null,
  observation: FloorObservation | null,
  eligibleEdgeIds: string[],
): CandidateView['state'] {
  const response = answer ?? observation;
  if (!response) return 'unanswered';
  if (response.answer === 'false') return 'rejected';
  if (response.answer === 'unknown') return 'deferred';
  if (!answer) return 'needs-points';
  if (answer.direction === 'unknown') return 'needs-direction';
  return answer.bindings && eligibleEdgeIds.includes(answer.bindings.edgeId)
    ? 'confirmed'
    : 'needs-review';
}

export function readConnectionCandidates() {
  const catalogue = z
    .object({
      schemaVersion: z.literal(1),
      candidates: z.array(connectionCandidateSchema).max(500),
    })
    .strict()
    .parse(
      JSON.parse(readFileSync(resolve(root, 'data/campus/connection-candidates.json'), 'utf8')),
    );
  if (
    new Set(catalogue.candidates.map((candidate) => candidate.id)).size !==
    catalogue.candidates.length
  )
    throw new Error('Connection candidate IDs must be unique.');
  const definitions = new Map(catalogue.candidates.map((candidate) => [candidate.id, candidate]));
  for (const candidate of catalogue.candidates) {
    const { from, to, kind } = candidate;
    if (
      candidate.drawingTrace &&
      (kind !== 'corridor' || from.planId !== to.planId || !from.point || !to.point)
    )
      throw new Error(
        `A proposed corridor line must join two marked points on one floor: ${candidate.id}`,
      );
    if (candidate.endpointRefs) {
      if (kind !== 'corridor' || from.planId !== to.planId)
        throw new Error(`Expected one floor for corridor ${candidate.id}`);
      for (const side of ['from', 'to'] as const) {
        const ref = candidate.endpointRefs[side];
        if (!ref) continue;
        const owner = definitions.get(ref.candidateId);
        const target = owner?.[ref.side];
        const pin = candidate[side];
        if (
          !owner ||
          owner.endpointRefs ||
          owner.id === candidate.id ||
          !target?.point ||
          target.planId !== pin.planId ||
          target.sourceSha256 !== pin.sourceSha256 ||
          target.kind !== pin.kind ||
          target.point.x !== pin.point?.x ||
          target.point.y !== pin.point.y
        ) {
          throw new Error(`Invalid endpoint reference for ${candidate.id} (${side})`);
        }
      }
    }
    if (
      (!from.point || !to.point) &&
      !(kind === 'elevator' && from.point === null && to.point === null)
    ) {
      throw new Error(`Missing proposal position: ${candidate.id}`);
    }
    if (kind !== 'stairs' && kind !== 'elevator') continue;
    const requiredKind = kind === 'stairs' ? 'stair-landing' : 'elevator-stop';
    const lower = visualPlans.find((plan) => plan.id === from.planId);
    const upper = visualPlans.find((plan) => plan.id === to.planId);
    if (
      from.kind !== requiredKind ||
      to.kind !== requiredKind ||
      !lower ||
      !upper ||
      lower.building !== upper.building ||
      lower.floor === upper.floor
    ) {
      throw new Error(`Invalid floor transition in candidate ${candidate.id}`);
    }
  }
  return catalogue.candidates;
}

/** Proposals never become graph nodes/edges on read. Existing manual corrections are shown for re-review. */
export function connectionCandidateViews(
  document: TopologyDocument,
  candidates: ConnectionCandidate[],
  plans: VisualPlan[],
  eligibility: TopologyEligibility,
): CandidateView[] {
  const latestAnswers = new Map(
    document.candidateAnswers.map((answer) => [answer.candidateId, answer]),
  );
  const definitions = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const savedNodes = new Map(document.nodes.map((node) => [node.id, node]));
  const eligibleNodes = new Set(eligibility.nodeIds);
  return candidates.map((candidate) => {
    const definitionHash = topologyContentHash(candidate);
    const latestAnswer = latestAnswers.get(candidate.id) ?? null;
    function sharedPoint(side: 'from' | 'to') {
      const ref = candidate.endpointRefs?.[side];
      if (!ref) return null;
      const owner = definitions.get(ref.candidateId);
      const answer = latestAnswers.get(ref.candidateId);
      if (!owner || !answer?.bindings || answer.definitionHash !== topologyContentHash(owner))
        return null;
      const id = ref.side === 'from' ? answer.bindings.fromNodeId : answer.bindings.toNodeId;
      const node = savedNodes.get(id);
      const pin = candidate[side];
      if (
        !node ||
        !eligibleNodes.has(id) ||
        node.planId !== pin.planId ||
        node.sourceSha256 !== pin.sourceSha256 ||
        node.kind !== pin.kind
      )
        return null;
      return { id, version: node.version };
    }
    const sharedEndpoints = candidate.endpointRefs
      ? { from: sharedPoint('from'), to: sharedPoint('to') }
      : undefined;
    const waitingForPoints = (['from', 'to'] as const).some(
      (side) => candidate.endpointRefs?.[side] && !sharedEndpoints?.[side],
    );
    const matchingDefinition = latestAnswer?.definitionHash === definitionHash;
    const latestFloorObservation =
      [...document.floorObservations]
        .reverse()
        .find(
          (entry) => entry.candidateId === candidate.id && entry.definitionHash === definitionHash,
        ) ?? null;
    const endpoint = (side: 'from' | 'to'): CandidateEndpoint => {
      if (candidate.endpointRefs?.[side]) {
        const binding = sharedEndpoints?.[side];
        const node = binding && savedNodes.get(binding.id);
        return node
          ? { ...candidate[side], point: node.point, label: node.label }
          : candidate[side];
      }
      if (!matchingDefinition || !latestAnswer)
        return latestFloorObservation?.[side] ?? candidate[side];
      if (latestAnswer.answer !== 'true' || latestAnswer.direction === 'unknown')
        return latestAnswer[side];
      const binding = latestAnswer.bindings?.[side === 'from' ? 'fromNodeId' : 'toNodeId'];
      const node = document.nodes.find((item) => item.id === binding);
      return node
        ? {
            ...latestAnswer[side],
            planId: node.planId,
            sourceSha256: node.sourceSha256,
            point: node.point,
            label: node.label,
            kind: node.kind,
          }
        : latestAnswer[side];
    };
    const from = endpoint('from'),
      to = endpoint('to');
    const onOriginalTrace = (['from', 'to'] as const).every((side) => {
      const current = side === 'from' ? from : to,
        original = candidate[side];
      return (
        current.planId === original.planId &&
        current.sourceSha256 === original.sourceSha256 &&
        current.point?.x === original.point?.x &&
        current.point?.y === original.point?.y
      );
    });
    const endpointTitle = (point: CandidateEndpoint) => {
      const plan = plans.find((item) => item.id === point.planId);
      return plan ? planLabel(plan) : point.planId;
    };
    const staleSource = [candidate.from, candidate.to, from, to].some(
      (point) =>
        plans.find((plan) => plan.id === point.planId)?.sourceSha256 !== point.sourceSha256,
    );
    const blockedReason = staleSource
      ? '후보의 원본 도면이 변경되었습니다. 최신 도면으로 후보를 다시 준비해야 합니다.'
      : null;
    const state = reviewState(
      matchingDefinition ? latestAnswer : null,
      latestFloorObservation,
      eligibility.edgeIds,
    );
    return {
      ...candidate,
      ...(candidate.drawingTrace && !onOriginalTrace ? { drawingTrace: undefined } : {}),
      title:
        from.planId !== candidate.from.planId || to.planId !== candidate.to.planId
          ? `${endpointTitle(from)} ↔ ${endpointTitle(to)} 연결 후보 (층 수정됨)`
          : candidate.title,
      from,
      to,
      allowsFloorOnlyAnswer:
        !latestAnswer &&
        candidate.kind === 'elevator' &&
        candidate.from.point === null &&
        candidate.to.point === null,
      definitionHash,
      latestAnswer,
      latestFloorObservation,
      state,
      blockedReason,
      ...(sharedEndpoints ? { sharedEndpoints, waitingForPoints } : {}),
      presentedHash: topologyContentHash({
        definitionHash,
        from,
        to,
        latestAnswerId: latestAnswer?.id ?? null,
        ...(sharedEndpoints ? { sharedEndpoints } : {}),
        ...(latestFloorObservation ? { floorObservationId: latestFloorObservation.id } : {}),
      }),
    };
  });
}
