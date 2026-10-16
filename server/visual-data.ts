import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { catalogue, root } from './data';
import type { PlanImage, VisualPlan } from '../src/types';
import type { ModelPart } from './provider';

const visualRoot = resolve(root, 'data/campus/visual');
const asset = z.object({
  file: z.string(),
  url: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().positive(),
  height: z.number().positive(),
});
export const boundsSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .refine(
    ([left, top, right, bottom]) => right > left && bottom > top,
    'Bounds must enclose a nonempty region',
  );
const planSchema = z.object({
  id: z.string().regex(/^(NE|NW|SE|SW)\d+-F\d+-p\d+$/),
  sourceId: z.string(),
  building: z.string(),
  floor: z.string(),
  page: z.number().int().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  sourceUrl: z.string().url(),
  sourceSha256: z.string(),
  sourceRef: z.string(),
  attribution: z.string(),
  full: asset,
  overview: asset,
  tiles: z.array(asset.extend({ id: z.string(), bounds: boundsSchema })),
  geometry: z.object({ file: z.string(), url: z.string(), sha256: z.string() }),
  primitiveCount: z.number().int().nonnegative(),
  longSegmentCount: z.number().int().nonnegative(),
  labelCount: z.number().int().nonnegative(),
});
const indexSchema = z.object({
  plans: z.array(planSchema),
  atlases: z.array(asset.extend({ id: z.string(), planIds: z.array(z.string()) })),
});
const indexPath = resolve(visualRoot, 'index.json');
const index = existsSync(indexPath)
  ? indexSchema.parse(JSON.parse(readFileSync(indexPath, 'utf8')))
  : { plans: [], atlases: [] };
export const visualPlans: VisualPlan[] = index.plans;
export const planAtlases = index.atlases;
const knownSources = new Set(
  catalogue.filter((record) => record.kind === 'floor-plan').map((record) => record.id),
);
for (const plan of visualPlans) {
  if (!knownSources.has(plan.sourceId))
    throw new Error(`Unknown source in visual index: ${plan.id}`);
}
const indexedPlanIds = planAtlases.flatMap((atlas) => atlas.planIds);
if (
  indexedPlanIds.length !== visualPlans.length ||
  new Set(indexedPlanIds).size !== visualPlans.length ||
  indexedPlanIds.some((id) => !visualPlans.some((plan) => plan.id === id))
)
  throw new Error('Visual overview sheets must cover each plan exactly once');

export function getVisualPlan(id: string) {
  const plan = visualPlans.find((item) => item.id === id);
  if (!plan) throw new Error('Unknown official floor-plan ID');
  return plan;
}

function verifiedBytes(asset: { file: string; sha256: string }) {
  const path = resolve(root, asset.file);
  if (!path.startsWith(visualRoot + sep)) throw new Error('Invalid floor-plan asset path');
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error('A floor-plan asset changed. Reprocess the source before analysis.');
  return bytes;
}

const imageCache = new Map<string, ModelPart>();
export function planImagePart(asset: PlanImage): ModelPart {
  const cached = imageCache.get(asset.sha256);
  if (cached) return cached;
  const bytes = verifiedBytes(asset);
  if (bytes.length > 4 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error('Invalid or oversized floor-plan PNG');
  const part: ModelPart = { inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } };
  if (imageCache.size >= 24) imageCache.delete(imageCache.keys().next().value!);
  imageCache.set(asset.sha256, part);
  return part;
}

const sourceLabelSchema = z.object({
  text: z.string(),
  bbox: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  method: z.string(),
  verified: z.boolean(),
});
export type SourceLabel = z.infer<typeof sourceLabelSchema>;
const geometryEvidenceSchema = z.object({
  id: z.string(),
  sourceSha256: z.string(),
  coordinateSystem: z.record(z.unknown()),
  extraction: z.record(z.unknown()),
  regions: z.array(z.unknown()),
  labels: z.array(sourceLabelSchema),
  modelSummary: z.object({
    totalPrimitives: z.number(),
    totalLongSegments: z.number(),
    sampledSegmentCount: z.number(),
    sampling: z.string(),
    segments: z.array(z.unknown()),
  }),
});
function loadGeometrySummary(plan: VisualPlan) {
  const data = geometryEvidenceSchema.parse(
    JSON.parse(verifiedBytes(plan.geometry).toString('utf8')),
  );
  if (data.id !== plan.id || data.sourceSha256 !== plan.sourceSha256)
    throw new Error('Geometry provenance does not match its plan');
  return {
    planId: plan.id,
    sourceRef: plan.sourceRef,
    coordinateSystem: data.coordinateSystem,
    extraction: data.extraction,
    regions: data.regions,
    ...data.modelSummary,
    // Legacy files contain an 80-label preview. Always use the complete source list.
    labels: data.labels,
    totalLabelCount: data.labels.length,
    omittedLabelCount: 0,
  };
}
const geometryCache = new Map<string, ReturnType<typeof loadGeometrySummary>>();
export function planGeometrySummary(plan: VisualPlan) {
  let summary = geometryCache.get(plan.geometry.sha256);
  if (!summary) {
    summary = loadGeometrySummary(plan);
    geometryCache.set(plan.geometry.sha256, summary);
  }
  return summary;
}
