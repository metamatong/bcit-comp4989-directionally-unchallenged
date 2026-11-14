/** Exact label retrieval, multi-label plan intersections, and coordinate-based follow-up evidence. */
import { z } from 'zod';
import type { VisualPlan } from '../src/types';
import { boundsSchema } from './visual-data';
import {
  canonicalBuilding,
  groupLabelOccurrences,
  overlappingBounds,
  labelKey,
  looksLikeIdentifier,
  pilotEvidence,
  type LabelObservation,
} from './pilot-evidence';
import { exactCheckpoints, reviewedNetwork } from './pilot-network';
import { passageInquiries } from './pilot-inquiries';

export const lookupSchema = z
  .object({
    purpose: z.enum(['origin', 'destination']),
    labels: z.array(z.string().trim().min(1).max(150)).min(1).max(32),
    building: z.string().trim().min(1).max(12).optional(),
    floor: z.string().trim().min(1).max(12).optional(),
  })
  .strict();
export const contextSchema = z.object({ planId: z.string().min(1), bounds: boundsSchema }).strict();

function source(plan: VisualPlan) {
  return {
    planId: plan.id,
    building: plan.building,
    floor: plan.floor,
    page: plan.page,
    sourceRef: plan.sourceRef,
    sourceUrl: plan.sourceUrl,
    sourceSha256: plan.sourceSha256,
    geometrySha256: plan.geometry.sha256,
  };
}
function scopedLabel(value: string) {
  const key = labelKey(value);
  const qualified = /^((?:NE|NW|SE|SW)\d+)(?:\s*-\s*|\s+)(.+)$/.exec(key);
  return qualified
    ? { building: qualified[1], label: qualified[2].trim() }
    : { building: undefined, label: key };
}
// Several OCR passes can see the same printed text. Never merge disjoint occurrences or other strings.
function occurrences(items: LabelObservation[]) {
  const priority = (item: LabelObservation) =>
    item.method === 'plan-transcription' ? 0 : item.method === 'geometry' ? 1 : 2;
  const groups = groupLabelOccurrences([...items].sort((a, b) => priority(a) - priority(b)));
  return groups.map((group) => ({
    occurrenceId: group[0].id,
    label: group[0].text,
    bounds: group[0].bounds,
    evidenceLevel:
      group[0].method === 'plan-transcription'
        ? ('plan-read' as const)
        : ('machine-extracted' as const),
    spaceUse: group.find((item) => item.spaceUse)?.spaceUse ?? null,
    observations: group,
  }));
}

function retrieveOne(text: string, scope?: string, floor?: string) {
  const token = scopedLabel(text);
  const building = canonicalBuilding(token.building ?? scope ?? '');
  const invalidScope =
    (!!(token.building ?? scope) && !building) ||
    (!!scope && !!token.building && canonicalBuilding(scope) !== building);
  const matches = pilotEvidence()
    .filter(
      ({ plan }) =>
        !invalidScope &&
        (!building || plan.building === building) &&
        (!floor || floor === plan.floor),
    )
    .flatMap(({ plan, byLabel, drawnDoors }) => {
      const words = byLabel.get(token.label) ?? [];
      const usable = words.filter(
        (item) => item.context === 'drawing' && item.disposition === 'candidate',
      );
      const points = exactCheckpoints(plan.id, token.label);
      if (!words.length && !points.length) return [];
      return [
        {
          ...source(plan),
          occurrences: occurrences(usable),
          doorHypotheses: drawnDoors.filter((door) => labelKey(door.room) === token.label),
          otherEvidence: words.filter(
            (item) => item.context !== 'drawing' || item.disposition !== 'candidate',
          ),
          // Only explicit checkpoint aliases qualify. A nearby room or a label's printed centre is never a door binding.
          checkpointCandidates: points,
        },
      ];
    });
  return { query: text, identifier: token.label, unsupportedScope: invalidScope, matches };
}
export function lookupPilotLabels(input: z.infer<typeof lookupSchema>) {
  const query = lookupSchema.parse(input);
  const results = [...new Set(query.labels)].map((text) =>
    retrieveOne(text, query.building, query.floor),
  );
  const sets = results.map(
    (result) =>
      new Set(
        result.matches
          .filter((m) => m.occurrences.length || m.checkpointCandidates.length)
          .map((m) => m.planId),
      ),
  );
  const commonPlanIds = [...sets[0]].filter((id) => sets.every((set) => set.has(id)));
  const count = sets.filter((set) => set.size).length;
  let outcome: 'unsupported' | 'partial' | 'conflicting' | 'ambiguous' | 'candidate';
  if (!count || results.some((result) => result.unsupportedScope)) outcome = 'unsupported';
  else if (count < sets.length) outcome = 'partial';
  else if (!commonPlanIds.length) outcome = 'conflicting';
  else if (
    commonPlanIds.length > 1 ||
    results.some((result) =>
      result.matches.some(
        (m) =>
          commonPlanIds.includes(m.planId) &&
          (m.occurrences.length > 1 || m.checkpointCandidates.length > 1),
      ),
    )
  )
    outcome = 'ambiguous';
  else outcome = 'candidate';
  let nextStep = 'report-no-supported-label';
  if (outcome === 'candidate')
    nextStep =
      query.purpose === 'origin'
        ? 'visually-verify-and-confirm-start'
        : 'check-reviewed-destination-door';
  else if (outcome === 'ambiguous') nextStep = 'clarify-building-floor-or-occurrence';
  else if (outcome === 'partial' || outcome === 'conflicting') nextStep = 'clarify-observed-labels';
  return {
    purpose: query.purpose,
    outcome,
    commonPlanIds,
    results,
    networkRevision: reviewedNetwork().revision,
    nextStep,
    coordinateSystem: 'normalized source page, top-left origin',
  };
}
export function getPilotContext(input: z.infer<typeof contextSchema>) {
  const { planId, bounds } = contextSchema.parse(input);
  const page = pilotEvidence().find(({ plan }) => plan.id === planId);
  if (!page) return { status: 'unsupported-plan' as const };
  const nodes = reviewedNetwork().nodes.filter(
    (n) =>
      n.planId === planId &&
      n.point.x >= bounds[0] &&
      n.point.x <= bounds[2] &&
      n.point.y >= bounds[1] &&
      n.point.y <= bounds[3],
  );
  const catalogue = passageInquiries();
  const questions = catalogue.questions.filter((question) =>
    [question.from, question.to].some(
      (side) =>
        side.planId === planId &&
        side.point.x >= bounds[0] &&
        side.point.x <= bounds[2] &&
        side.point.y >= bounds[1] &&
        side.point.y <= bounds[3],
    ),
  );
  return {
    status: 'source-context' as const,
    ...source(page.plan),
    bounds,
    networkRevision: reviewedNetwork().revision,
    observations: page.observations.filter((item) => overlappingBounds(item.bounds, bounds)),
    doorHypotheses: page.drawnDoors.filter(
      ({ point }) =>
        point.x >= bounds[0] &&
        point.x <= bounds[2] &&
        point.y >= bounds[1] &&
        point.y <= bounds[3],
    ),
    checkpointsInRegion: nodes,
    passageReviewQuestions: questions.map((question) => ({
      ...question,
      supportingMap: catalogue.supportingMap,
    })),
    floorServiceReports: reviewedNetwork().elevatorReports.filter(
      (r) => r.from.planId === planId || r.to.planId === planId,
    ),
    relation: 'co-located-on-drawing' as const,
  };
}
export function pilotCoverage() {
  const net = reviewedNetwork();
  return pilotEvidence().map(({ plan, observations, drawnDoors }) => {
    const nodes = net.nodes.filter((node) => node.planId === plan.id);
    const ids = new Set(nodes.map((node) => node.id));
    const drawn = observations.filter(
      (o) => o.context === 'drawing' && o.disposition === 'candidate',
    );
    return {
      ...source(plan),
      geometryLabels: observations.filter((o) => o.method === 'geometry').length,
      ocrWords: observations.filter((o) => o.method === 'ocr').length,
      distinctIdentifierCandidates: new Set(
        drawn.map((o) => labelKey(o.text)).filter(looksLikeIdentifier),
      ).size,
      planReadLabels: drawn.filter((o) => o.method === 'plan-transcription').length,
      planReadDoorSymbols: drawnDoors.length,
      reviewedCheckpoints: nodes.length,
      unreviewedPassageQuestions: passageInquiries().questions.filter(
        (q) => q.from.planId === plan.id || q.to.planId === plan.id,
      ).length,
      elevatorReports: net.elevatorReports.filter(
        (r) => r.from.planId === plan.id || r.to.planId === plan.id,
      ),
      incidentReviewedPassages: net.edges.filter(
        (e) => ids.has(e.fromNodeId) || ids.has(e.toNodeId),
      ).length,
    };
  });
}
