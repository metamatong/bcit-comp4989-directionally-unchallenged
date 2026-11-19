/** Source-page bend coordinates for walkable corridors. Traces never approve a connection. */
import { z } from 'zod';
import { checkedSpatialJson, pilotEvidence } from './pilot-evidence';
import {
  planLabel,
  type TopologyEdge,
  normalizedPointSchema,
  doorwayOpeningSchema,
  type ConnectionCandidate,
  type TopologyDocument,
  type TopologyEligibility,
} from '../src/topology';
import type { PagePoint, MapStop } from '../src/wayfinding';
import type { VisualPlan } from '../src/types';
import { topologyContentHash } from './topology-provenance';
import type { SourceDoorwayOpening } from './route-geometry';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const traceSchema = z
  .object({
    candidateId: z.string(),
    definitionHash: hash,
    planId: z.string(),
    sourceSha256: hash,
    from: normalizedPointSchema,
    to: normalizedPointSchema,
    bends: z.array(normalizedPointSchema).min(1),
    instruction: z.string().min(1),
    departureDoorId: z.string().optional(),
    arrivalDoorId: z.string().optional(),
    initialReviewHash: hash.optional(),
    doorwayOpenings: z.array(doorwayOpeningSchema).max(16).optional(),
  })
  .strict();
type Trace = z.infer<typeof traceSchema>;
const catalogue = z
  .object({ schemaVersion: z.literal(1), traces: z.array(traceSchema) })
  .strict()
  .parse(checkedSpatialJson('corridor-traces'));
// Original edge receipts for journals saved before the editor recorded these on each answer.
export const initialCorridorReviewHashes = new Map(
  catalogue.traces.flatMap((trace) =>
    trace.initialReviewHash ? [[trace.candidateId, trace.initialReviewHash] as const] : [],
  ),
);
const samePoint = (a: PagePoint | null, b: PagePoint) => a?.x === b.x && a.y === b.y;

function matchesSource(trace: Trace, candidates: ConnectionCandidate[], plans: VisualPlan[]) {
  const candidate = candidates.find((item) => item.id === trace.candidateId);
  return (
    candidate?.kind === 'corridor' &&
    topologyContentHash(candidate) === trace.definitionHash &&
    plans.some((plan) => plan.id === trace.planId && plan.sourceSha256 === trace.sourceSha256) &&
    [candidate.from, candidate.to].every(
      (point) => point.planId === trace.planId && point.sourceSha256 === trace.sourceSha256,
    ) &&
    samePoint(candidate.from.point, trace.from) &&
    samePoint(candidate.to.point, trace.to)
  );
}
function corridorTraces(candidates: ConnectionCandidate[]): Trace[] {
  const proposals = candidates.flatMap((candidate) => {
    const trace = candidate.drawingTrace;
    if (!trace || !candidate.from.point || !candidate.to.point) return [];
    return [
      {
        candidateId: candidate.id,
        definitionHash: topologyContentHash(candidate),
        planId: candidate.from.planId,
        sourceSha256: candidate.from.sourceSha256,
        from: candidate.from.point,
        to: candidate.to.point,
        bends: trace.bends,
        instruction: trace.instruction,
        departureDoorId: trace.fromDoorId,
        arrivalDoorId: trace.toDoorId,
        doorwayOpenings: trace.doorwayOpenings,
      },
    ];
  });
  return [...catalogue.traces, ...proposals];
}

/** Drawing geometry can guide AI routing independently of a topology approval. */
export function sourceCorridorTraces(candidates: ConnectionCandidate[], plans: VisualPlan[]) {
  return corridorTraces(candidates)
    .filter((trace) => matchesSource(trace, candidates, plans))
    .map((trace) => ({
      planId: trace.planId,
      sourceSha256: trace.sourceSha256,
      path: [trace.from, ...trace.bends, trace.to],
      doorwayOpenings: (trace.doorwayOpenings ?? []).map((opening) => ({
        ...opening,
        planId: trace.planId,
        sourceSha256: trace.sourceSha256,
      })),
    }));
}
function doorForTrace(trace: Trace, doorId: string, point: PagePoint) {
  return pilotEvidence()
    .find((p) => p.plan.id === trace.planId)
    ?.drawnDoors.find((d) => d.id === doorId && samePoint(d.point, point));
}
export function validateCorridorTraces(candidates: ConnectionCandidate[], plans: VisualPlan[]) {
  const traces = corridorTraces(candidates);
  if (new Set(traces.map((t) => t.candidateId)).size !== traces.length)
    throw new Error('Duplicate pilot corridor trace.');
  for (const trace of traces) {
    if (
      !matchesSource(trace, candidates, plans) ||
      (trace.arrivalDoorId && !doorForTrace(trace, trace.arrivalDoorId, trace.to)) ||
      (trace.departureDoorId && !doorForTrace(trace, trace.departureDoorId, trace.from))
    )
      throw new Error(`Corridor trace needs current source evidence: ${trace.candidateId}`);
  }
  return traces.length;
}

export function visitorPassages(
  doc: TopologyDocument,
  eligibility: TopologyEligibility,
  candidates: ConnectionCandidate[],
  plans: VisualPlan[],
) {
  const approved = new Set(eligibility.edgeIds);
  const nodes = new Map(doc.nodes.map((node) => [node.id, node]));
  const edges = new Map(doc.edges.filter((e) => approved.has(e.id)).map((edge) => [edge.id, edge]));
  const latest = new Map(doc.candidateAnswers.map((answer) => [answer.candidateId, answer]));
  const definitions = new Map(
    candidates.map((candidate) => [candidate.id, topologyContentHash(candidate)]),
  );
  const transferAnswers = new Map(
    [...latest.values()].flatMap((answer) =>
      answer.bindings ? [[answer.bindings.edgeId, answer] as const] : [],
    ),
  );
  const allowed = new Set(
    [...edges.values()]
      .filter((edge) => {
        if (edge.kind === 'corridor') return false;
        const answer = transferAnswers.get(edge.id);
        // A corrected building-passage definition must not keep an older endpoint approval routable.
        return (
          !answer ||
          (answer.answer === 'true' &&
            answer.direction !== 'unknown' &&
            answer.definitionHash === definitions.get(answer.candidateId))
        );
      })
      .map((edge) => edge.id),
  );
  const traces = new Map<
    string,
    {
      fromId: string;
      path: PagePoint[];
      instruction: string;
      doorwayOpenings: SourceDoorwayOpening[];
    }
  >();
  const doors = new Map<string, string>();
  const definitionsWithTraces = corridorTraces(candidates);
  const activeTraceIds = new Set<string>();
  for (const trace of definitionsWithTraces) {
    const answer = latest.get(trace.candidateId);
    if (
      !answer?.bindings ||
      answer.answer !== 'true' ||
      !answer.direction ||
      answer.direction === 'unknown' ||
      answer.definitionHash !== trace.definitionHash ||
      !matchesSource(trace, candidates, plans)
    )
      continue;
    const binding = answer.bindings;
    const edge = edges.get(binding.edgeId);
    const from = nodes.get(binding.fromNodeId),
      to = nodes.get(binding.toNodeId);
    const reviewHash = binding.reviewedEdgeHash ?? trace.initialReviewHash;
    if (
      !edge ||
      edge.kind !== 'corridor' ||
      !reviewHash ||
      edge.review?.contentHash !== reviewHash ||
      !from ||
      !to ||
      from.planId !== trace.planId ||
      to.planId !== trace.planId ||
      !samePoint(from.point, trace.from) ||
      !samePoint(to.point, trace.to) ||
      ![edge.fromNodeId, edge.toNodeId].every((id) => id === from.id || id === to.id)
    )
      continue;
    allowed.add(edge.id);
    activeTraceIds.add(trace.candidateId);
    traces.set(edge.id, {
      fromId: from.id,
      path: [trace.from, ...trace.bends, trace.to],
      instruction: trace.instruction,
      doorwayOpenings: (trace.doorwayOpenings ?? []).map((opening) => ({
        ...opening,
        planId: trace.planId,
        sourceSha256: trace.sourceSha256,
      })),
    });
    if (trace.departureDoorId && doorForTrace(trace, trace.departureDoorId, trace.from))
      doors.set(trace.departureDoorId, from.id);
    if (trace.arrivalDoorId && doorForTrace(trace, trace.arrivalDoorId, trace.to))
      doors.set(trace.arrivalDoorId, to.id);
  }
  const withdrawn = definitionsWithTraces
    .filter(
      (trace) =>
        latest.has(trace.candidateId) &&
        !activeTraceIds.has(trace.candidateId) &&
        plans.some((p) => p.id === trace.planId && p.sourceSha256 === trace.sourceSha256),
    )
    .map((trace) => ({
      planId: trace.planId,
      path: [trace.from, ...trace.bends, trace.to],
    }));
  return { allowed, traces, doors, withdrawn };
}

export function stepText(kind: TopologyEdge['kind'], to: MapStop, plans: VisualPlan[]) {
  const target = planLabel(plans.find((p) => p.id === to.planId)!);
  switch (kind) {
    case 'stairs':
      return `Take the stairs to ${target}.`;
    case 'elevator':
      return `Take the elevator to ${target}.`;
    case 'building-link':
      return `Use the connecting passage to ${target}.`;
    case 'outdoor':
      return `Walk outdoors to ${to.label} on ${target}. The outdoor walking line has not been mapped.`;
    case 'corridor':
      return `Follow the marked corridor to ${to.label}.`;
  }
}
