import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PHOTO_CROP_REGIONS } from '../src/photo-views';
import type { PlanBounds } from '../src/types';
import type { PhotoEvidenceRequest, PhotoRequest } from '../server/photo-media';
import type { ModelPart } from '../server/provider';

/** Source PNG reused as protocol fixture only; it does not represent a campus-photo benchmark. */
export const fixtureImage = {
  mimeType: 'image/png' as const,
  data: readFileSync('data/campus/visual/png/SE12-F1-p1/overview.png').toString('base64'),
};
export function photoInput(overrides: Partial<PhotoEvidenceRequest> = {}): PhotoEvidenceRequest {
  return {
    requestId: randomUUID(),
    revision: 0,
    consent: true,
    description: '',
    image: { ...fixtureImage },
    detailCrops: PHOTO_CROP_REGIONS.map((crop) => ({
      id: crop.id,
      bounds: [...crop.bounds] as PlanBounds,
      image: { ...fixtureImage },
    })),
    ...overrides,
  };
}
export function comparisonInput(
  input: PhotoEvidenceRequest,
  evidenceId: string,
  revision = input.revision + 1,
): PhotoRequest {
  return { ...structuredClone(input), requestId: randomUUID(), revision, evidenceId };
}
export function labelReading(
  text: string | null = '302',
  clarity: 'clear' | 'uncertain' = 'clear',
): ModelPart[] {
  return [
    {
      functionCall: {
        name: 'read_photo_labels',
        args: {
          labels: text ? [{ text, clarity, viewId: 'ne' }] : [],
          observations: ['A corridor with exterior glazing is visible.'],
        },
      },
    },
  ];
}
export function shortlist(ids = ['SE12-F3-p1']): ModelPart[] {
  return [
    {
      functionCall: {
        name: 'select_floor_plans',
        args: {
          planIds: ids,
          observations: ['A corridor is visible.'],
          explanation: 'Inspect source plans.',
          clarification: 'Another view may help.',
        },
      },
    },
  ];
}
export function comparison(
  overrides: Record<string, unknown> = {},
  planId = 'SE12-F3-p1',
): ModelPart[] {
  return [
    {
      functionCall: {
        name: 'propose_campus_locations',
        args: {
          outcome: 'candidates',
          observations: ['An exterior corridor and a room sign.'],
          summary: 'A possible region requires confirmation.',
          clarification: '',
          candidates: [
            {
              planId,
              bounds: [0.2, 0.3, 0.5, 0.6],
              confidence: 'low',
              matches: [
                {
                  photoFeature: 'Corridor and sign',
                  planFeature: 'Source drawing with an adjoining room label',
                },
              ],
              limitations: ['Mocked model output, not field validation.'],
              labelMatches: [{ observedLabel: '302', planLabel: '302' }],
            },
          ],
          ...overrides,
        },
      },
    },
  ];
}
