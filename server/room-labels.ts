import type { PhotoLabelReading } from '../src/types';
import { planGeometrySummary, visualPlans, type SourceLabel } from './visual-data';

/** Exact whole-label keys. Never strip digits, prefixes, suffixes or leading zeroes. */
export function normalizeRoomLabel(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}
export type IndexedRoomLabel = SourceLabel & {
  planId: string;
  sourceRef: string;
  building: string;
  floor: string;
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
export function retrieveRoomLabels(
  readings: PhotoLabelReading[],
  eligiblePlanIds: ReadonlySet<string>,
) {
  const index = roomLabelIndex();
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
  const clearMatchPlanIds = [
    ...new Set(
      matches
        .filter((match) => clearLabels.includes(match.observedLabel))
        .map((match) => match.planId),
    ),
  ];
  return { indexedLabels: index.labelCount, clearLabels, matches, clearMatchPlanIds };
}
