/** Read-only export of the currently approved pilot checkpoints and passage directions. */
import { z } from 'zod';
import type { VisualPlan } from '../src/types';
import { checkedSpatialJson, labelKey, pilotEvidence } from './pilot-evidence';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive();
const review = {
  version,
  reviewContentHash: hash,
  reviewBasis: z.enum(['user-confirmation', 'plan', 'field', 'plan-and-field']),
  fieldObservedOn: z.string().date().optional(),
};
const node = z
  .object({
    ...review,
    id: z.string().uuid(),
    planId: z.string(),
    sourceSha256: hash,
    label: z.string().min(1),
    aliases: z.array(z.string().min(1)).min(1),
    kind: z.enum([
      'door',
      'junction',
      'stair-landing',
      'elevator-stop',
      'outdoor-access',
      'checkpoint',
    ]),
    point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  })
  .strict();
const edge = z
  .object({
    ...review,
    id: z.string().uuid(),
    fromNodeId: z.string().uuid(),
    toNodeId: z.string().uuid(),
    endpointVersions: z.object({ from: version, to: version }).strict(),
    kind: z.enum(['corridor', 'stairs', 'elevator', 'building-link', 'outdoor']),
    direction: z.enum(['forward', 'both']),
    distanceMeters: z.number().finite().positive().nullable(),
    sourceCandidateId: z.string().min(1).nullable(),
    candidateBinding: z
      .object({
        definitionHash: hash,
        presentedHash: hash,
        fromNodeId: z.string().uuid(),
        toNodeId: z.string().uuid(),
        reviewedEdgeHash: hash.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    sourceDocumentSha256: hash,
    nodes: z.array(node),
    edges: z.array(edge),
    elevatorReports: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          definitionHash: hash,
          answer: z.enum(['true', 'false', 'unknown']),
          from: z.object({ planId: z.string(), sourceSha256: hash }).strict(),
          to: z.object({ planId: z.string(), sourceSha256: hash }).strict(),
        })
        .strict(),
    ),
  })
  .strict();

export function validateNetworkExport(value: unknown, plans: VisualPlan[]) {
  const data = schema.parse(value);
  const ids = [...data.nodes, ...data.edges].map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate spatial graph ID');
  const planMap = new Map(plans.map((plan) => [plan.id, plan]));
  const nodes = new Map(data.nodes.map((item) => [item.id, item]));
  for (const report of data.elevatorReports) {
    const from = planMap.get(report.from.planId),
      to = planMap.get(report.to.planId);
    if (
      !from ||
      !to ||
      from.building !== to.building ||
      from.floor === to.floor ||
      from.sourceSha256 !== report.from.sourceSha256 ||
      to.sourceSha256 !== report.to.sourceSha256
    )
      throw new Error(`Stale floor-service report: ${report.candidateId}`);
  }
  for (const point of data.nodes) {
    if (planMap.get(point.planId)?.sourceSha256 !== point.sourceSha256)
      throw new Error(`Spatial point needs current official source: ${point.id}`);
  }
  for (const passage of data.edges) {
    const from = nodes.get(passage.fromNodeId),
      to = nodes.get(passage.toNodeId);
    if (
      !from ||
      !to ||
      from.id === to.id ||
      passage.endpointVersions.from !== from.version ||
      passage.endpointVersions.to !== to.version
    )
      throw new Error(`Stale spatial endpoints: ${passage.id}`);
    const binding = passage.candidateBinding;
    if (
      binding &&
      (!passage.sourceCandidateId ||
        binding.fromNodeId === binding.toNodeId ||
        ![binding.fromNodeId, binding.toNodeId].every((id) => id === from.id || id === to.id))
    )
      throw new Error(`Invalid candidate endpoint binding: ${passage.id}`);
    const a = planMap.get(from.planId)!,
      b = planMap.get(to.planId)!;
    const vertical = passage.kind === 'stairs' || passage.kind === 'elevator';
    if (
      (passage.kind === 'corridor' && a.id !== b.id) ||
      (passage.kind === 'building-link' && a.building === b.building) ||
      (passage.kind === 'outdoor' &&
        (from.kind !== 'outdoor-access' || to.kind !== 'outdoor-access')) ||
      (vertical &&
        (a.building !== b.building ||
          a.floor === b.floor ||
          from.kind !== (passage.kind === 'stairs' ? 'stair-landing' : 'elevator-stop') ||
          to.kind !== from.kind))
    )
      throw new Error(`Invalid passage type: ${passage.id}`);
  }
  return data;
}
let network: z.infer<typeof schema> | undefined;
export function reviewedNetwork() {
  return (network ??= validateNetworkExport(
    checkedSpatialJson('reviewed-network'),
    pilotEvidence().map((page) => page.plan),
  ));
}
export function exactCheckpoints(planId: string, query: string) {
  return reviewedNetwork().nodes.filter(
    (point) =>
      point.planId === planId && point.aliases.some((alias) => labelKey(alias) === labelKey(query)),
  );
}
export function outgoingPassages(nodeId: string) {
  const data = reviewedNetwork();
  const point = data.nodes.find((item) => item.id === nodeId);
  if (!point)
    return { status: 'unsupported-checkpoint' as const, revision: data.revision, passages: [] };
  const passages = data.edges.flatMap((passage) => {
    const forward = passage.fromNodeId === nodeId;
    if (!forward && !(passage.toNodeId === nodeId && passage.direction === 'both')) return [];
    const nextNodeId = forward ? passage.toNodeId : passage.fromNodeId;
    return [{ ...passage, next: data.nodes.find((item) => item.id === nextNodeId)! }];
  });
  return { status: 'reviewed-checkpoint' as const, revision: data.revision, point, passages };
}
