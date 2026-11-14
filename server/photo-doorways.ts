/** Offer exact source doorways for visual comparison without asking the model to estimate page coordinates. */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type {
  CampusLocationCandidate,
  PlanBounds,
  PlanLabelReference,
  VisualPlan,
} from '../src/types';
import type { ModelPart } from './provider';
import { centerIn, isPilotPlan, labelKey, pilotEvidence } from './pilot-evidence';
import { identifiersIn } from './photo-grounding';
import { verifiedVisualBytes } from './visual-data';

type DrawnDoor = ReturnType<typeof pilotEvidence>[number]['drawnDoors'][number];
type DoorwayOption = {
  door: DrawnDoor;
  plan: VisualPlan;
  label: PlanLabelReference;
  pageBounds: PlanBounds;
};
const sides = ['left', 'right', 'unclear'] as const;
const layoutRelations = [
  'glazing-opposite-door',
  'opposite-corridor-edge',
  'corridor-junction',
  'doorway-sequence',
] as const;
const observation = z.string().trim().min(1).max(350);

export const doorwayAssessmentSchema = z
  .object({
    doorId: z.string().min(1).max(150),
    verdict: z.enum(['supported', 'ambiguous', 'contradicted']),
    observedLabel: z.string().min(1).max(32),
    signAtDoor: z.boolean(),
    layoutVisibleInPhoto: z.boolean(),
    layoutMatchesDrawing: z.boolean(),
    relation: z.enum(layoutRelations),
    doorSide: z.enum(sides),
    glazingSide: z.enum(sides),
    photoFeature: observation,
    planFeature: observation,
  })
  .strict();
type DoorwayAssessment = z.infer<typeof doorwayAssessmentSchema>;

export const doorwayAssessmentToolField = {
  type: 'ARRAY',
  description:
    'Assess every supplied doorway ID once, even when the camera rectangle is unknown. Use supported only when the sign is attached to or beside the visible doorway AND a separate architectural relation agrees with the plan crop. Read left/right from the photo, not compass directions. Use ambiguous for text alone, unresolved alternatives or uncertain geometry. Use contradicted for an incompatible layout. Omit room numbers from the two physical feature descriptions.',
  items: {
    type: 'OBJECT',
    properties: {
      doorId: { type: 'STRING' },
      verdict: { type: 'STRING', enum: ['supported', 'ambiguous', 'contradicted'] },
      observedLabel: { type: 'STRING' },
      signAtDoor: { type: 'BOOLEAN' },
      layoutVisibleInPhoto: {
        type: 'BOOLEAN',
        description:
          'A physical corridor relation is visible in the photo independently of the text.',
      },
      layoutMatchesDrawing: {
        type: 'BOOLEAN',
        description: 'The same corridor relation is supported by the supplied local plan crop.',
      },
      relation: { type: 'STRING', enum: [...layoutRelations] },
      doorSide: { type: 'STRING', enum: [...sides] },
      glazingSide: { type: 'STRING', enum: [...sides] },
      photoFeature: { type: 'STRING' },
      planFeature: { type: 'STRING' },
    },
    required: [
      'doorId',
      'verdict',
      'observedLabel',
      'signAtDoor',
      'layoutVisibleInPhoto',
      'layoutMatchesDrawing',
      'relation',
      'doorSide',
      'glazingSide',
      'photoFeature',
      'planFeature',
    ],
  },
};

export function matchingDoorways(
  plans: VisualPlan[],
  references: PlanLabelReference[],
): DoorwayOption[] {
  const options: DoorwayOption[] = [];
  for (const plan of plans.filter(isPilotPlan)) {
    const page = pilotEvidence().find((p) => p.plan.id === plan.id)!;
    for (const door of page.drawnDoors) {
      // A drawing door currently references the room text. Disjoint reprints require an explicit occurrence binding.
      const prints = references.filter(
        (ref) =>
          ref.planId === plan.id &&
          ref.sourceSha256 === plan.sourceSha256 &&
          labelKey(ref.label) === labelKey(door.room),
      );
      if (prints.length !== 1) continue;
      const label = prints[0];
      const { width, height } = plan.full;
      const pad = Math.ceil(Math.min(width, height) * 0.06);
      const [l, t, r, b] = label.bounds;
      const pageBounds: PlanBounds = [
        Math.max(0, Math.floor(Math.min(l, door.point.x) * width) - pad) / width,
        Math.max(0, Math.floor(Math.min(t, door.point.y) * height) - pad) / height,
        Math.min(width, Math.ceil(Math.max(r, door.point.x) * width) + pad) / width,
        Math.min(height, Math.ceil(Math.max(b, door.point.y) * height) + pad) / height,
      ];
      options.push({ door, plan, label, pageBounds });
    }
  }
  return options;
}

/** Crop framing is for source inspection only; these bounds never become a camera area or a routing origin. */
export async function doorwayDetailParts(options: DoorwayOption[]): Promise<ModelPart[]> {
  const parts: ModelPart[] = [];
  for (const { plan, door, pageBounds } of options) {
    const { width, height } = plan.full;
    const source = verifiedVisualBytes(plan.full);
    const [l, t, r, b] = pageBounds;
    const left = Math.round(l * width),
      top = Math.round(t * height),
      right = Math.round(r * width),
      bottom = Math.round(b * height);
    const detail = await sharp(source)
      .extract({ left, top, width: right - left, height: bottom - top })
      .resize({ width: 1000, height: 800, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    parts.push(
      {
        text: `OFFICIAL DOORWAY DETAIL ${JSON.stringify({
          doorId: door.id,
          planId: plan.id,
          room: door.room,
          doorPointOnPage: door.point,
          doorPointInDetail: {
            x: (door.point.x * width - left) / (right - left),
            y: (door.point.y * height - top) / (bottom - top),
          },
          pageBounds,
          sourceSha256: plan.sourceSha256,
        })}. Inspect the doorway and the two sides of its corridor on this unmarked drawing. Assess the complete photo-to-plan relation.`,
      },
      { inlineData: { mimeType: 'image/png', data: detail.toString('base64') } },
    );
  }
  return parts;
}

export function matchDoorwayVicinity(
  options: DoorwayOption[],
  assessments: DoorwayAssessment[],
  references: PlanLabelReference[],
): CampusLocationCandidate | undefined {
  const supported = assessments.filter((a) => a.verdict === 'supported');
  const answers = new Map(assessments.map((a) => [a.doorId, a]));
  if (
    supported.length !== 1 ||
    assessments.length !== options.length ||
    answers.size !== options.length ||
    options.some((option) => !answers.has(option.door.id))
  )
    return;
  const assessment = supported[0];
  const { door, plan, label, pageBounds } = options.find(
    (option) => option.door.id === assessment.doorId,
  )!;
  const room = labelKey(door.room);
  if (
    !assessment.signAtDoor ||
    !assessment.layoutVisibleInPhoto ||
    !assessment.layoutMatchesDrawing ||
    labelKey(assessment.observedLabel) !== room
  )
    return;
  if (
    assessment.relation === 'glazing-opposite-door' &&
    (assessment.doorSide === 'unclear' ||
      assessment.glazingSide === 'unclear' ||
      assessment.doorSide === assessment.glazingSide)
  )
    return;
  // Two plausible entrances for this room remain ambiguous. A second sign on the same frontage can corroborate it.
  if (
    options.some(
      (other) =>
        other.door.id !== door.id &&
        labelKey(other.door.room) === room &&
        answers.get(other.door.id)?.verdict !== 'contradicted',
    )
  )
    return;
  // A second occurrence or page without an assessed doorway still competes for the same sign.
  if (
    references.some(
      (ref) =>
        labelKey(ref.label) === room && !options.some((option) => option.label.id === ref.id),
    )
  )
    return;
  const sourceLabels = [label];
  for (const other of new Set(references.map((ref) => labelKey(ref.label)))) {
    if (other === room) continue;
    const local = references.filter(
      (ref) =>
        ref.planId === plan.id &&
        labelKey(ref.label) === other &&
        (centerIn(ref.bounds, pageBounds) ||
          options.some(
            (option) =>
              option.label.id === ref.id &&
              answers.get(option.door.id)?.verdict !== 'contradicted' &&
              option.door.point.x >= pageBounds[0] &&
              option.door.point.x <= pageBounds[2] &&
              option.door.point.y >= pageBounds[1] &&
              option.door.point.y <= pageBounds[3],
          )),
    );
    if (local.length !== 1) return;
    sourceLabels.push(local[0]);
  }
  const allowed = new Set(sourceLabels.map((ref) => labelKey(ref.label)));
  if (
    identifiersIn(assessment.photoFeature + ' ' + assessment.planFeature).some(
      (id) => !allowed.has(id),
    )
  )
    return;
  return {
    id: randomUUID(),
    planId: plan.id,
    building: plan.building,
    floor: plan.floor,
    page: plan.page,
    sourceRef: plan.sourceRef,
    // A point-only doorway carries no corridor extent. Consumers render the reference and require an exact reviewed checkpoint.
    bounds: door.corridorBounds ?? null,
    confidence: 'low',
    verification: 'unverified-ai-hypothesis',
    doorwayVicinity: {
      doorId: door.id,
      room: door.room,
      point: { ...door.point },
      sourceSha256: plan.sourceSha256,
    },
    sourceLabels,
    labelMatches: sourceLabels.map((ref) => ({ observedLabel: ref.label, planLabel: ref.label })),
    matches: [
      {
        photoFeature: assessment.photoFeature,
        planFeature: assessment.planFeature,
        kind: 'architecture',
      },
    ],
    limitations: [
      'The doorway identifies a possible starting vicinity. The exact camera point and heading are unknown.',
    ],
  };
}
