/** Source-page bend coordinates for walkable corridors. Traces never approve a connection. */
import { z } from 'zod';
import { checkedSpatialJson, pilotEvidence } from './pilot-evidence';
import {
  normalizedPointSchema,
  type ConnectionCandidate,
  type TopologyDocument,
  type TopologyEligibility,
} from '../src/topology';
import type { PagePoint } from '../src/wayfinding';
import type { VisualPlan } from '../src/types';
import { topologyContentHash } from './topology-provenance';

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
  })
  .strict();
type Trace = z.infer<typeof traceSchema>;
const catalogue = z
  .object({ schemaVersion: z.literal(1), traces: z.array(traceSchema) })
  .strict()
  .parse(checkedSpatialJson('corridor-traces'));
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
      },
    ];
  });
  return [...catalogue.traces, ...proposals];
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
  const allowed = new Set(
    [...edges.values()].filter((e) => e.kind !== 'corridor').map((e) => e.id),
  );
  const traces = new Map<string, { fromId: string; path: PagePoint[]; instruction: string }>();
  const doors = new Map<string, string>();
  for (const trace of corridorTraces(candidates)) {
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
    traces.set(edge.id, {
      fromId: from.id,
      path: [trace.from, ...trace.bends, trace.to],
      instruction: trace.instruction,
    });
    if (trace.departureDoorId && doorForTrace(trace, trace.departureDoorId, trace.from))
      doors.set(trace.departureDoorId, from.id);
    if (trace.arrivalDoorId && doorForTrace(trace, trace.arrivalDoorId, trace.to))
      doors.set(trace.arrivalDoorId, to.id);
  }
  return { allowed, traces, doors };
}
