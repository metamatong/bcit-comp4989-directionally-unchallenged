import type { PhotoLabelReading } from '../src/types';
import { planGeometrySummary, visualPlans, type SourceLabel } from './visual-data';
import { isPilotPlan, drawingPhotoLabels, labelKey } from './pilot-evidence';

/** Exact whole-label keys. Never strip digits, prefixes, suffixes or leading zeroes. */
export function normalizeRoomLabel(text: string): string {
  return labelKey(text);
}
export type IndexedRoomLabel = SourceLabel & {
  planId: string;
  sourceRef: string;
  building: string;
  floor: string;
  evidenceId?: string;
};
export class RoomLabelIndex {
  readonly labelCount: number;
  private readonly labels = new Map<string, IndexedRoomLabel[]>();
  constructor(records: IndexedRoomLabel[]) {
    this.labelCount = records.length;
    for (const record of records) {
      const key = normalizeRoomLabel(record.text);
      if (!key) continue;
      const matches = this.labels.get(key) ?? [];
      matches.push(record);
      this.labels.set(key, matches);
    }
  }
  find(text: string, eligiblePlanIds?: ReadonlySet<string>) {
    return (this.labels.get(normalizeRoomLabel(text)) ?? []).filter(
      (label) => !eligiblePlanIds || eligiblePlanIds.has(label.planId),
    );
  }
}
let sourceIndex: RoomLabelIndex | undefined;
export function roomLabelIndex() {
  sourceIndex ??= new RoomLabelIndex(
    visualPlans.flatMap((plan) =>
      planGeometrySummary(plan).labels.map((label) => ({
        ...label,
        planId: plan.id,
        sourceRef: plan.sourceRef,
        building: plan.building,
        floor: plan.floor,
      })),
    ),
  );
  return sourceIndex;
}
let photoIndex: RoomLabelIndex | undefined;
function photoLabelIndex() {
  photoIndex ??= new RoomLabelIndex(
    visualPlans.flatMap((plan) => {
      const labels = isPilotPlan(plan)
        ? drawingPhotoLabels(plan)
        : planGeometrySummary(plan).labels;
      return labels.map((label) => ({
        ...label,
        planId: plan.id,
        building: plan.building,
        floor: plan.floor,
        sourceRef: plan.sourceRef,
      }));
    }),
  );
  return photoIndex;
}
export function retrieveRoomLabels(
  readings: PhotoLabelReading[],
  eligiblePlanIds: ReadonlySet<string>,
) {
  const index = photoLabelIndex();
  const clearLabels = [
    ...new Set(
      readings
        .filter((reading) => reading.clarity === 'clear')
        .map((reading) => normalizeRoomLabel(reading.text)),
    ),
  ];
  const queries = [...new Set(readings.map((reading) => normalizeRoomLabel(reading.text)))];
  const matches = queries.flatMap((observedLabel) =>
    index.find(observedLabel, eligiblePlanIds).map((match) => ({ ...match, observedLabel })),
  );
  const clearMatches = matches.filter((match) => clearLabels.includes(match.observedLabel));
  const clearMatchPlanIds = [...new Set(clearMatches.map((match) => match.planId))];
  const hasCorroboratedLabel = clearMatches.some((match) => match.method !== 'pilot-ocr');
  return {
    indexedLabels: index.labelCount,
    clearLabels,
    matches,
    clearMatchPlanIds,
    hasCorroboratedLabel,
  };
}
