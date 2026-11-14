import { z } from 'zod';
import type { VisualPlan } from './types';

export const topologyBuildings = ['SE12', 'SW3', 'SW1'] as const;
export const pointKinds = [
  'door',
  'junction',
  'stair-landing',
  'elevator-stop',
  'outdoor-access',
  'checkpoint',
] as const;
export const connectionKinds = [
  'corridor',
  'stairs',
  'elevator',
  'building-link',
  'outdoor',
] as const;
export const pointKindLabels: Record<(typeof pointKinds)[number], string> = {
  door: 'Door',
  junction: 'Corridor junction',
  'stair-landing': 'Stair landing',
  'elevator-stop': 'Elevator stop',
  'outdoor-access': 'Exterior doorway',
  checkpoint: 'Checkpoint',
};
export const connectionKindLabels: Record<(typeof connectionKinds)[number], string> = {
  corridor: 'Same-floor passage',
  stairs: 'Stairs',
  elevator: 'Elevator',
  'building-link': 'Between buildings',
  outdoor: 'Outdoor passage',
};
const identifier = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();
export const normalizedPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();
export const evidenceSchema = z
  .object({
    basis: z.enum(['plan', 'field', 'plan-and-field', 'user-confirmation']),
    note: z.string().trim().max(3000),
    observedOn: z.string().date().nullable(),
  })
  .strict();
const reviewSchema = z
  .object({
    status: z.enum(['draft', 'verified', 'rejected']),
    reviewer: z.string().trim().min(1).max(100),
    note: z.string().trim().min(1).max(2000),
    reviewedAt: timestamp,
    recordVersion: z.number().int().positive(),
    contentHash: hash,
    legacyContentHash: hash.optional(),
    evidence: evidenceSchema,
  })
  .strict();
const recordFields = {
  id: identifier,
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  evidence: evidenceSchema,
  review: reviewSchema.nullable(),
  reviewHistory: z.array(reviewSchema).max(1000),
};
const pointFields = {
  planId: z.string().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(pointKinds),
  point: normalizedPointSchema,
  notes: z.string().trim().max(2000),
  evidence: evidenceSchema,
};
export const topologyNodeSchema = z
  .object({
    ...recordFields,
    ...pointFields,
    sourceSha256: hash,
  })
  .strict();
const connectionFields = {
  fromNodeId: identifier,
  toNodeId: identifier,
  kind: z.enum(connectionKinds),
  direction: z.enum(['both', 'forward']),
  notes: z.string().trim().max(2000),
  distanceMeters: z.number().finite().positive().max(10000).nullable(),
  distanceEvidence: z.string().trim().max(1000),
  evidence: evidenceSchema,
};
export const topologyEdgeSchema = z
  .object({
    ...recordFields,
    ...connectionFields,
    endpointVersions: z
      .object({ from: z.number().int().positive(), to: z.number().int().positive() })
      .strict(),
  })
  .strict();
export const candidateEndpointSchema = z
  .object({
    planId: z.string().min(1).max(80),
    sourceSha256: hash,
    point: normalizedPointSchema.nullable(),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(pointKinds),
    description: z.string().trim().min(1).max(1000),
  })
  .strict();
const candidateEndpointRef = z
  .object({
    candidateId: z.string().min(1).max(100),
    side: z.enum(['from', 'to']),
  })
  .strict();
export const connectionCandidateSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(connectionKinds),
    from: candidateEndpointSchema,
    to: candidateEndpointSchema,
    /** Source-page walking line proposed for this A/B review. Its geometry participates in the review hash. */
    drawingTrace: z
      .object({
        bends: z.array(normalizedPointSchema).max(128),
        instruction: z.string().trim().min(1).max(500),
        fromDoorId: z.string().min(1).optional(),
        toDoorId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    endpointRefs: z
      .object({ from: candidateEndpointRef.optional(), to: candidateEndpointRef.optional() })
      .strict()
      .refine((refs) => !!refs.from || !!refs.to)
      .optional(),
    rationale: z.string().trim().min(1).max(3000),
    supportingSource: z
      .object({
        title: z.string().trim().min(1).max(150),
        url: z.string().url().startsWith('https://www.bcit.ca/'),
        sha256: hash,
      })
      .strict()
      .optional(),
    preparedBy: z.literal('assistant-source-review'),
    preparedOn: z.string().date(),
  })
  .strict();
const candidateAnswerFields = {
  answer: z.enum(['true', 'false', 'unknown']),
  direction: z.enum(['both', 'a-to-b', 'b-to-a', 'unknown']).nullable(),
  reviewer: z.string().trim().min(1).max(100),
  note: z.string().trim().max(2000),
};
const markedCandidateEndpointSchema = candidateEndpointSchema.extend({
  point: normalizedPointSchema,
});
const floorObservationFields = {
  answer: candidateAnswerFields.answer,
  reviewer: candidateAnswerFields.reviewer,
  note: candidateAnswerFields.note,
};
// A floor inquiry can be recorded before any landing has been identified.
// It has no graph bindings or direction and cannot represent a point confirmation.
const floorObservationSchema = z
  .object({
    id: identifier,
    candidateId: z.string().min(1).max(100),
    definitionHash: hash,
    presentedHash: hash,
    answeredAt: timestamp,
    from: candidateEndpointSchema,
    to: candidateEndpointSchema,
    ...floorObservationFields,
  })
  .strict();
export const candidateAnswerSchema = z
  .object({
    id: identifier,
    candidateId: z.string().min(1).max(100),
    definitionHash: hash,
    presentedHash: hash,
    ...candidateAnswerFields,
    answeredAt: timestamp,
    from: markedCandidateEndpointSchema,
    to: markedCandidateEndpointSchema,
    bindings: z
      .object({
        fromNodeId: identifier,
        toNodeId: identifier,
        edgeId: identifier,
        reviewedEdgeHash: hash.optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
const candidatePositionSchema = markedCandidateEndpointSchema
  .pick({ planId: true, sourceSha256: true, point: true })
  .strict();
const inquiryPositionSchema = candidateEndpointSchema
  .pick({ planId: true, sourceSha256: true, point: true })
  .strict();
export const topologyDocumentSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    revision: z.number().int().nonnegative(),
    updatedAt: timestamp.nullable(),
    nodes: z.array(topologyNodeSchema).max(2000),
    edges: z.array(topologyEdgeSchema).max(5000),
    candidateAnswers: z.array(candidateAnswerSchema).max(10000).default([]),
    floorObservations: z.array(floorObservationSchema).max(10000).default([]),
  })
  .strict();
export const topologyCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('record-floor-observation'),
      candidateId: z.string().min(1).max(100),
      presentedHash: hash,
      from: inquiryPositionSchema,
      to: inquiryPositionSchema,
      ...floorObservationFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('answer-candidate'),
      candidateId: z.string().min(1).max(100),
      presentedHash: hash,
      from: candidatePositionSchema,
      to: candidatePositionSchema,
      ...candidateAnswerFields,
    })
    .strict(),
  z.object({ type: z.literal('save-node'), id: identifier.optional(), ...pointFields }).strict(),
  z
    .object({ type: z.literal('save-edge'), id: identifier.optional(), ...connectionFields })
    .strict(),
  z.object({ type: z.literal('delete-node'), id: identifier }).strict(),
  z.object({ type: z.literal('delete-edge'), id: identifier }).strict(),
  z
    .object({
      type: z.literal('review'),
      target: z.enum(['node', 'edge']),
      id: identifier,
      status: z.enum(['draft', 'verified', 'rejected']),
      reviewer: z.string().trim().min(1).max(100),
      note: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export const topologyMutationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    command: topologyCommandSchema,
  })
  .strict();
export const topologyRouteRequestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    fromNodeId: identifier,
    toNodeId: identifier,
    mode: z.enum(['fewest-connections', 'measured-distance']),
  })
  .strict();
export type TopologyNode = z.infer<typeof topologyNodeSchema>;
export type TopologyEdge = z.infer<typeof topologyEdgeSchema>;
export type TopologyRecord = TopologyNode | TopologyEdge;
export type ConnectionCandidate = z.infer<typeof connectionCandidateSchema>;
export type CandidateEndpoint = z.infer<typeof candidateEndpointSchema>;
export type CandidateAnswer = z.infer<typeof candidateAnswerSchema>;
export type FloorObservation = z.infer<typeof floorObservationSchema>;
export type CandidateView = ConnectionCandidate & {
  definitionHash: string;
  presentedHash: string;
  allowsFloorOnlyAnswer: boolean;
  latestAnswer: CandidateAnswer | null;
  latestFloorObservation: FloorObservation | null;
  blockedReason: string | null;
  sharedEndpoints?: {
    from: { id: string; version: number } | null;
    to: { id: string; version: number } | null;
  };
  waitingForPoints?: boolean;
  state:
    | 'unanswered'
    | 'confirmed'
    | 'rejected'
    | 'deferred'
    | 'needs-review'
    | 'needs-direction'
    | 'needs-points';
};
export type TopologyDocument = z.infer<typeof topologyDocumentSchema>;
export type TopologyCommand = z.infer<typeof topologyCommandSchema>;
export type TopologyEvidence = z.infer<typeof evidenceSchema>;
export type TopologyRouteRequest = z.infer<typeof topologyRouteRequestSchema>;
export type NodeDraft = Omit<Extract<TopologyCommand, { type: 'save-node' }>, 'type'>;
export type EdgeDraft = Omit<Extract<TopologyCommand, { type: 'save-edge' }>, 'type'>;
export type TopologyEligibility = {
  nodeIds: string[];
  edgeIds: string[];
  issues: { id: string; target: 'node' | 'edge'; reason: string }[];
};
export type TopologyBootstrap = {
  document: TopologyDocument;
  plans: VisualPlan[];
  eligibility: TopologyEligibility;
  candidates: CandidateView[];
};
export type TopologyRoute = {
  revision: number;
  mode: TopologyRouteRequest['mode'];
  outcome: 'route' | 'no-route';
  nodeIds: string[];
  edgeIds: string[];
  distanceMeters: number | null;
  message: string;
};
export function reviewStatus(record: TopologyRecord) {
  return record.review?.status ?? 'draft';
}
export function buildingLabel(building: string) {
  return building === 'SW1' ? 'SW01' : building === 'SW3' ? 'SW03' : building;
}
export function planLabel(plan: Pick<VisualPlan, 'building' | 'floor'>) {
  return `${buildingLabel(plan.building)} · Floor ${plan.floor}`;
}
/** Coordinates belong to the entire source page, independent of displayed zoom. */
export function pointOnPlan(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const point = { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  return normalizedPointSchema.safeParse(point).success ? point : null;
}
