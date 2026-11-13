/** Source-bound labels on the twelve SE12, SW3 and SW1 floor plans. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { PlanBounds, VisualPlan } from '../src/types';
import { root, readJson } from './data';
import { boundsSchema, planGeometrySummary, visualPlans } from './visual-data';

export const pilotBuildings = ['SE12', 'SW3', 'SW1'] as const;
export type PilotBuilding = (typeof pilotBuildings)[number];
export function canonicalBuilding(text: string): PilotBuilding | undefined {
  const aliases: Record<string, PilotBuilding> = {
    SE12: 'SE12',
    SW03: 'SW3',
    SW3: 'SW3',
    SW01: 'SW1',
    SW1: 'SW1',
  };
  const key = text.normalize('NFKC').trim().toUpperCase();
  return Object.hasOwn(aliases, key) ? aliases[key] : undefined;
}
export function isPilotPlan(plan: VisualPlan) {
  return pilotBuildings.some((building) => building === plan.building);
}
export const labelKey = (text: string) =>
  text.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
export const looksLikeIdentifier = (text: string) =>
  /^[A-Z]?\d{3,4}[A-Z]?(?:-\d+[A-Z]?)?$/.test(labelKey(text));
export const spatialDir = 'data/campus/spatial';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const pageFields = { planId: z.string(), sourceSha256: digest };
const ocrSchema = z.object({
  schemaVersion: z.literal(1),
  engine: z.string(),
  renderer: z.string(),
  dpi: z.array(z.number()),
  language: z.literal('eng'),
  psm: z.literal(11),
  pages: z.array(
    z.object({
      ...pageFields,
      geometrySha256: digest,
      page: z.number().int().positive(),
      words: z.array(
        z.object({
          text: z.string().min(1),
          bounds: boundsSchema,
          confidence: z.number().min(0).max(100),
          dpi: z.number().positive(),
          mode: z.enum(['gray', 'rgb']),
          rotation: z.union([z.literal(0), z.literal(90), z.literal(270)]),
        }),
      ),
    }),
  ),
});
const annotationsSchema = z.object({
  schemaVersion: z.literal(1),
  basis: z.literal('manual-plan-transcription'),
  plans: z.array(
    z.object({
      ...pageFields,
      drawingRegion: boundsSchema,
      labels: z.array(
        z.object({
          text: z.string().min(1),
          kind: z.string().min(1),
          bounds: boundsSchema,
        }),
      ),
      doors: z.array(
        z
          .object({
            room: z.string().min(1),
            point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
            adjoiningLabel: z.string().nullable(),
          })
          .strict(),
      ),
      rejectedOcr: z
        .array(z.object({ text: z.string(), region: boundsSchema, printed: z.string() }))
        .optional(),
    }),
  ),
});
export function checkedSpatialJson(name: 'pilot-ocr' | 'reviewed-network'): unknown {
  const file = resolve(root, spatialDir, name);
  const bytes = readFileSync(file + '.json');
  const expected = readFileSync(file + '.sha256', 'utf8').trim();
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error(`Invalid spatial asset hash: ${name}`);
  return JSON.parse(bytes.toString('utf8'));
}
export type LabelObservation = {
  id: string;
  text: string;
  bounds: PlanBounds;
  method: 'geometry' | 'ocr' | 'plan-transcription';
  sourceMethod: string;
  context: 'drawing' | 'margin';
  disposition: 'candidate' | 'conflicts-with-plan';
  spaceUse?: string;
  confidence?: number;
  dpi?: number;
  rotation?: number;
  mode?: 'gray' | 'rgb';
};
export function centerIn(bounds: PlanBounds, region: PlanBounds) {
  const x = (bounds[0] + bounds[2]) / 2,
    y = (bounds[1] + bounds[3]) / 2;
  return x >= region[0] && x <= region[2] && y >= region[1] && y <= region[3];
}
function byPage<T extends { planId: string }>(items: T[], plans: VisualPlan[]) {
  const map = new Map(items.map((item) => [item.planId, item]));
  if (
    map.size !== items.length ||
    map.size !== plans.length ||
    plans.some((plan) => !map.has(plan.id))
  )
    throw new Error('Pilot evidence must cover each of the twelve official pages exactly once.');
  return map;
}
function loadEvidence() {
  const plans = visualPlans.filter(isPilotPlan);
  const expectedIds = pilotBuildings.flatMap((building) =>
    [1, 2, 3, 4].map((floor) => `${building}-F${floor}-p1`),
  );
  if (plans.length !== 12 || expectedIds.some((id) => !plans.some((plan) => plan.id === id)))
    throw new Error('Incomplete official pilot plan inventory.');
  const manifest = readJson<{
    sources: { id: string; campus: string; kind: string; sha256: string; url: string }[];
  }>('data/campus/manifest.json');
  const ocr = ocrSchema.parse(checkedSpatialJson('pilot-ocr'));
  const pages = byPage(ocr.pages, plans);
  const reviewed = byPage(
    annotationsSchema.parse(readJson(spatialDir + '/plan-annotations.json')).plans,
    plans,
  );
  return plans.map((plan) => {
    const page = pages.get(plan.id)!,
      annotation = reviewed.get(plan.id)!;
    const original = manifest.sources.find((entry) => entry.id === plan.sourceId);
    if (
      !original ||
      original.campus !== 'Burnaby' ||
      original.kind !== 'floor-plan' ||
      original.sha256 !== plan.sourceSha256 ||
      original.url !== plan.sourceUrl
    )
      throw new Error(`Pilot plan disagrees with the official source manifest: ${plan.id}`);
    if (
      page.sourceSha256 !== plan.sourceSha256 ||
      annotation.sourceSha256 !== plan.sourceSha256 ||
      page.geometrySha256 !== plan.geometry.sha256 ||
      page.page !== plan.page
    )
      throw new Error(`Pilot evidence needs review against the current plan: ${plan.id}`);
    // Original geometry is validated by the same source hash as photo localization.
    const observations: LabelObservation[] = [];
    function add(observation: Omit<LabelObservation, 'id' | 'context'>, sequence: number) {
      observations.push({
        ...observation,
        id: `${plan.id}:${observation.method}:${sequence + 1}`,
        context: centerIn(observation.bounds, annotation.drawingRegion) ? 'drawing' : 'margin',
      });
    }
    planGeometrySummary(plan).labels.forEach((label, i) => {
      const [l, t, r, b] = label.bbox;
      add(
        {
          text: label.text,
          bounds: [l / plan.width, t / plan.height, r / plan.width, b / plan.height],
          method: 'geometry',
          sourceMethod: label.method,
          disposition: 'candidate',
        },
        i,
      );
    });
    page.words.forEach((word, i) => {
      const conflict = annotation.rejectedOcr?.some(
        (rule) => labelKey(rule.text) === labelKey(word.text) && centerIn(word.bounds, rule.region),
      );
      add(
        {
          ...word,
          method: 'ocr',
          sourceMethod: ocr.engine,
          disposition: conflict ? 'conflicts-with-plan' : 'candidate',
        },
        i,
      );
    });
    annotation.labels.forEach((label, i) => {
      if (!centerIn(label.bounds, annotation.drawingRegion))
        throw new Error(`Reviewed label outside the drawing: ${plan.id} ${label.text}`);
      add(
        {
          text: label.text,
          bounds: label.bounds,
          method: 'plan-transcription',
          sourceMethod: 'manual-plan-transcription',
          disposition: 'candidate',
          spaceUse: label.kind,
        },
        i,
      );
    });
    for (const rule of annotation.rejectedOcr ?? []) {
      if (
        !annotation.labels.some(
          (label) => label.text === rule.printed && centerIn(label.bounds, rule.region),
        )
      )
        throw new Error(`Unsubstantiated OCR conflict: ${plan.id} ${rule.printed}`);
    }
    const byLabel = new Map<string, LabelObservation[]>();
    for (const item of observations) {
      const key = labelKey(item.text);
      const existing = byLabel.get(key);
      if (existing) existing.push(item);
      else byLabel.set(key, [item]);
    }
    const drawnDoors = annotation.doors.map((door, i) => {
      const [left, top, right, bottom] = annotation.drawingRegion;
      if (
        !annotation.labels.some((label) => label.text === door.room) ||
        door.point.x < left ||
        door.point.x > right ||
        door.point.y < top ||
        door.point.y > bottom
      )
        throw new Error(`Door is missing its source label or page region: ${plan.id} ${door.room}`);
      return {
        ...door,
        id: `${plan.id}:drawn-door:${i + 1}`,
        basis: 'plan-read-door-symbol' as const,
      };
    });
    return { plan, drawingRegion: annotation.drawingRegion, observations, byLabel, drawnDoors };
  });
}
let cache: ReturnType<typeof loadEvidence> | undefined;
export function pilotEvidence() {
  return (cache ??= loadEvidence());
}

export function drawingPhotoLabels(plan: VisualPlan) {
  const records = pilotEvidence().find((page) => page.plan.id === plan.id)?.observations ?? [];
  return records
    .filter((item) => item.context === 'drawing' && item.disposition === 'candidate')
    .map((item) => ({
      text: item.text,
      method: item.method === 'ocr' ? 'pilot-ocr' : item.sourceMethod,
      verified: false,
      evidenceId: item.id,
      bbox: [
        item.bounds[0] * plan.width,
        item.bounds[1] * plan.height,
        item.bounds[2] * plan.width,
        item.bounds[3] * plan.height,
      ] as PlanBounds,
    }));
}
