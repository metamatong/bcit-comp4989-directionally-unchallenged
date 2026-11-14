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
function doorForTrace(trace: Trace) {
  return pilotEvidence()
    .find((p) => p.plan.id === trace.planId)
    ?.drawnDoors.find((d) => d.id === trace.arrivalDoorId && samePoint(d.point, trace.to));
}
export function validateCorridorTraces(candidates: ConnectionCandidate[], plans: VisualPlan[]) {
  if (new Set(catalogue.traces.map((t) => t.candidateId)).size !== catalogue.traces.length)
    throw new Error('Duplicate pilot corridor trace.');
  for (const trace of catalogue.traces) {
    if (!matchesSource(trace, candidates, plans) || (trace.arrivalDoorId && !doorForTrace(trace)))
      throw new Error(`Corridor trace needs current source evidence: ${trace.candidateId}`);
  }
  return catalogue.traces.length;
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
  for (const trace of catalogue.traces) {
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
    if (trace.arrivalDoorId && doorForTrace(trace)) doors.set(trace.arrivalDoorId, to.id);
  }
  return { allowed, traces, doors };
}
