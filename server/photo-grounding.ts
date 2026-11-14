/** Check a visually proposed camera region against printed evidence on the same source page. */
import type {
  CameraRegionIssue,
  LabelMatch,
  PlanBounds,
  PlanLabelReference,
  VisualPlan,
  VisualFeatureMatch,
} from '../src/types';
import {
  centerIn,
  groupLabelOccurrences,
  isPilotPlan,
  labelKey,
  looksLikeIdentifier,
  pilotEvidence,
} from './pilot-evidence';
import { isSourceReadLabel, type IndexedRoomLabel, type retrieveRoomLabels } from './room-labels';

type Retrieved = ReturnType<typeof retrieveRoomLabels>;
type Occurrence = PlanLabelReference & { corroborated: boolean };

export function normalizedLabelBounds(label: IndexedRoomLabel, plan: VisualPlan): PlanBounds {
  const [left, top, right, bottom] = label.bbox;
  return [left / plan.width, top / plan.height, right / plan.width, bottom / plan.height];
}

function occurrencesFor(plan: VisualPlan, retrieval: Retrieved, label: string): Occurrence[] {
  const priority = (method: string) =>
    method === 'manual-plan-transcription' ? 0 : isSourceReadLabel(method) ? 1 : 2;
  const records = retrieval.matches
    .filter((m) => m.planId === plan.id && m.observedLabel === label)
    .map((m) => ({ ...m, bounds: normalizedLabelBounds(m, plan) }))
    .sort((a, b) => priority(a.method) - priority(b.method));
  return groupLabelOccurrences(records).map((group) => {
    const first = group[0];
    return {
      id: first.evidenceId!,
      planId: plan.id,
      sourceSha256: plan.sourceSha256,
      label,
      bounds: first.bounds,
      corroborated: group.some((m) => isSourceReadLabel(m.method)),
    };
  });
}

export function sourcePhotoReferences(
  retrieval: Retrieved,
  plans: VisualPlan[],
): PlanLabelReference[] {
  const matches = retrieval.matches.filter(
    (m) => retrieval.clearLabels.includes(m.observedLabel) && isSourceReadLabel(m.method),
  );
  return plans.flatMap((plan) =>
    [...new Set(matches.filter((m) => m.planId === plan.id).map((m) => m.observedLabel))].flatMap(
      (label) => occurrencesFor(plan, retrieval, label).filter((o) => o.corroborated),
    ),
  );
}

/** Without a visual choice, show print only if the corroborated readings identify a single page. */
export function singlePlanLabelReferences(retrieval: Retrieved, plans: VisualPlan[]) {
  const references = sourcePhotoReferences(retrieval, plans);
  return new Set(references.map((r) => r.planId)).size === 1 ? references : [];
}

export function identifiersIn(text: string) {
  // Match whole room-shaped tokens. Never take a prefix from a longer identifier.
  return (
    labelKey(text).match(/(?<![A-Z0-9-])[A-Z]?\d{3,4}[A-Z]?(?:-\d+[A-Z]?)?(?![A-Z0-9-])/g) ?? []
  );
}

type VisualCandidate = {
  planId: string;
  bounds: PlanBounds;
  labelMatches: LabelMatch[];
  matches: VisualFeatureMatch[];
  limitations: string[];
};

export function groundPhotoRegion(
  plan: VisualPlan,
  candidate: VisualCandidate,
  retrieval: Retrieved,
  summary: string,
) {
  const page = isPilotPlan(plan) ? pilotEvidence().find((p) => p.plan.id === plan.id) : undefined;
  const clear = new Set(retrieval.clearLabels);
  const required = new Set(
    retrieval.matches
      .filter((m) => clear.has(m.observedLabel) && isSourceReadLabel(m.method))
      .map((m) => m.observedLabel),
  );
  const claimed = new Set(candidate.labelMatches.map((m) => labelKey(m.observedLabel)));
  const references: PlanLabelReference[] = [];
  const supporting: PlanLabelReference[] = [];
  const allowed = new Set<string>();
  const issues = new Set<CameraRegionIssue>();
  if (
    candidate.labelMatches.some(
      (match) => labelKey(match.observedLabel) !== labelKey(match.planLabel),
    )
  )
    issues.add('label-mismatch');
  for (const label of new Set([...required, ...claimed])) {
    const occurrences = occurrencesFor(plan, retrieval, label);
    // A conflicting OCR-only reading elsewhere must never outrank the source transcription.
    const reliable = occurrences.filter((o) => o.corroborated);
    const locations = reliable.length ? reliable : occurrences;
    const doors =
      locations.length === 1
        ? (page?.drawnDoors.filter((d) => labelKey(d.room) === label) ?? [])
        : [];
    const adjacent = doors.some(
      ({ point }) =>
        point.x >= candidate.bounds[0] &&
        point.x <= candidate.bounds[2] &&
        point.y >= candidate.bounds[1] &&
        point.y <= candidate.bounds[3],
    );
    const supported = locations.filter((o) => centerIn(o.bounds, candidate.bounds) || adjacent);
    if (clear.has(label)) references.push(...reliable);
    if (!claimed.has(label) || !clear.has(label) || !reliable.length) {
      issues.add('label-mismatch');
    } else if (supported.length !== 1) {
      issues.add('region-mismatch');
    } else {
      supporting.push(supported[0]);
      allowed.add(label);
    }
  }
  // A room may also appear in the generated prose even when omitted from the structured matches.
  // Descriptions of the camera's location may only name an identifier corroborated for this region.
  const planClaims = [
    summary,
    ...candidate.limitations,
    ...candidate.matches.flatMap((m) => [m.photoFeature, m.planFeature]),
  ];
  if (!candidate.matches.some((m) => m.kind === 'architecture'))
    issues.add('appearance-unverified');
  // A box spanning other printed rooms does not isolate this doorway as a starting region.
  if (
    page &&
    supporting.length &&
    page.observations.some(
      (item) =>
        item.context === 'drawing' &&
        item.disposition === 'candidate' &&
        isSourceReadLabel(item.sourceMethod) &&
        looksLikeIdentifier(item.text) &&
        !allowed.has(labelKey(item.text)) &&
        centerIn(item.bounds, candidate.bounds),
    )
  )
    issues.add('region-too-broad');
  if (planClaims.some((sentence) => identifiersIn(sentence).some((id) => !allowed.has(id))))
    issues.add('unsupported-identifier');
  return { conflict: issues.size > 0, issues: [...issues], references, sourceLabels: supporting };
}
