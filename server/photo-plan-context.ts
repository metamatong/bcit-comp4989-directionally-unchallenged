/** Compact source context retains every label and original-page coordinates. */
import sharp from 'sharp';
import type { PlanBounds, PlanLabelReference, VisualPlan } from '../src/types';
import type { ModelPart } from './provider';
import { doorwayDetailParts, matchingDoorways } from './photo-doorways';
import { planGeometrySummary, planImagePart, verifiedVisualBytes } from './visual-data';

const overviewCache = new Map<string, ModelPart>();
export async function shortlistOverview(plan: VisualPlan): Promise<ModelPart> {
  const cached = overviewCache.get(plan.overview.sha256);
  if (cached) return cached;
  const bytes = await sharp(verifiedVisualBytes(plan.overview))
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const part: ModelPart = { inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } };
  if (overviewCache.size >= 24) overviewCache.delete(overviewCache.keys().next().value!);
  overviewCache.set(plan.overview.sha256, part);
  return part;
}

export function compactPlanGeometry(plan: VisualPlan) {
  const summary = planGeometrySummary(plan);
  return {
    planId: plan.id,
    sourceRef: plan.sourceRef,
    sourceSha256: plan.sourceSha256,
    coordinateSystem: summary.coordinateSystem,
    limitations: summary.extraction.limitations,
    labelFields: ['text', 'bboxPdfPoints', 'method', 'verified'],
    labels: summary.labels.map((label) => [label.text, label.bbox, label.method, label.verified]),
    totalLabelCount: summary.totalLabelCount,
    omittedLabelCount: 0,
    segmentFields: ['primitiveId', 'normalizedCoordinates'],
    segments: summary.segments.map((value) => {
      const segment = value as { primitiveId: string; coordinates: number[] };
      return [segment.primitiveId, segment.coordinates];
    }),
    sampling: summary.sampling,
    totalPrimitives: summary.totalPrimitives,
  };
}

async function labelContextCrop(
  plan: VisualPlan,
  reference: PlanLabelReference,
): Promise<ModelPart[]> {
  const { width, height } = plan.full;
  const pad = Math.ceil(Math.min(width, height) * 0.09);
  const [l, t, r, b] = reference.bounds;
  const left = Math.max(0, Math.floor(l * width) - pad);
  const top = Math.max(0, Math.floor(t * height) - pad);
  const right = Math.min(width, Math.ceil(r * width) + pad);
  const bottom = Math.min(height, Math.ceil(b * height) + pad);
  const pageBounds: PlanBounds = [left / width, top / height, right / width, bottom / height];
  const bytes = await sharp(verifiedVisualBytes(plan.full))
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return [
    {
      text: `OFFICIAL LABEL CONTEXT ${JSON.stringify({ planId: plan.id, label: reference.label, pageBounds, sourceSha256: plan.sourceSha256 })}. Compare the adjoining architecture. Crop bounds identify source inspection framing. Return camera coordinates in the whole original page.`,
    },
    { inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } },
  ];
}

export async function detailedPlanContext(plans: VisualPlan[], references: PlanLabelReference[]) {
  const doorways = matchingDoorways(plans, references);
  const parts: ModelPart[] = [];
  let detailCount = 0;
  for (const plan of plans) {
    const localReferences = references.filter((reference) => reference.planId === plan.id);
    const localDoors = doorways.filter((option) => option.plan.id === plan.id);
    parts.push(
      {
        text: `OFFICIAL FLOOR PLAN ${plan.id}. Overview uses original page coordinates. Source: ${plan.sourceRef}.`,
      },
      planImagePart(plan.overview),
    );
    if (localReferences.length) {
      parts.push(...(await doorwayDetailParts(localDoors)));
      detailCount += localDoors.length;
      for (const reference of localReferences) {
        if (localDoors.some((option) => option.label.id === reference.id)) continue;
        parts.push(...(await labelContextCrop(plan, reference)));
        detailCount++;
      }
    } else {
      // With no source-bound location reference, retain coverage of every page quadrant.
      for (const tile of plan.tiles) {
        parts.push(
          {
            text: `${plan.id} DETAIL ${tile.id}; bounds in original page coordinates [left,top,right,bottom]=${JSON.stringify(tile.bounds)}. Convert any crop-based match back to page coordinates.`,
          },
          planImagePart(tile),
        );
        detailCount++;
      }
    }
    parts.push({
      text: `EXTRACTED GEOMETRY (untrusted source evidence): ${JSON.stringify(compactPlanGeometry(plan))}`,
    });
  }
  return { parts, doorways, detailCount };
}
