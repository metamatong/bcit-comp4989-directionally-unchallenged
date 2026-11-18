/** Resolve first-stage structured evidence against exact source records, without images or model calls. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CampusLocationCandidate, CampusPhotoAnalysis, Session } from '../src/types';
import { canonicalBuilding, isPilotPlan, labelKey, pilotEvidence } from './pilot-evidence';
import { retrieveRoomLabels } from './room-labels';
import { sourcePhotoReferences } from './photo-grounding';
import { PhotoEvidenceError, type PhotoEvidenceRecord } from './photo-evidence';
import { visualPlans } from './visual-data';
import { locationCatalogue } from './geolocation';
import { logActivity } from './session';

export const labelLocationRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    evidenceId: z.string().uuid(),
    gps: z
      .object({
        buildings: z
          .array(z.enum(['SE12', 'SW3', 'SW1']))
          .max(3)
          .refine((items) => new Set(items).size === items.length),
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        capturedAt: z.number().finite(),
        accuracy: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LabelLocationRequest = z.infer<typeof labelLocationRequestSchema>;

export function selectLocatedCandidate(session: Session, candidateId: string) {
  const candidate = session.campusAnalysis?.candidates.find((item) => item.id === candidateId);
  if (!candidate)
    throw new PhotoEvidenceError('Choose a candidate from the current location result.');
  session.campusLocation = structuredClone(candidate);
  session.notice = `Selected the estimated area on ${candidate.building}, floor ${candidate.floor}.`;
}

export function locateFromLabels(
  session: Session,
  input: LabelLocationRequest,
  record?: PhotoEvidenceRecord,
) {
  if (
    !record ||
    record.sessionId !== session.id ||
    record.evidence.id !== input.evidenceId ||
    session.photoEvidence?.id !== input.evidenceId
  )
    throw new PhotoEvidenceError('Read the current photo before locating its labels.');
  if (Date.parse(record.evidence.expiresAt) <= Date.now())
    throw new PhotoEvidenceError('Photo evidence expired. Read the photo again.');
  const started = performance.now();
  const evidence = record.evidence;
  const roomReadings = evidence.labels.filter((label) => !label.kind || label.kind === 'room');
  const clearRooms = roomReadings.filter(
    (label) => label.clarity === 'clear' && label.placement !== 'directional-sign',
  );
  const buildingLabels = evidence.labels.filter(
    (label) =>
      label.kind === 'building' &&
      label.clarity === 'clear' &&
      label.placement !== 'directional-sign',
  );
  const buildings = new Set<string>(
    buildingLabels.flatMap((label) => {
      const building = canonicalBuilding(label.text);
      return building ? [building] : [];
    }),
  );
  const floors = new Set(
    evidence.labels
      .filter(
        (label) =>
          label.kind === 'floor' &&
          label.clarity === 'clear' &&
          label.placement !== 'directional-sign',
      )
      .map((label) => labelKey(label.text)),
  );
  const eligible = visualPlans.filter(
    (plan) =>
      isPilotPlan(plan) &&
      (!record.buildingHint || plan.building === canonicalBuilding(record.buildingHint)),
  );
  const retrieval = retrieveRoomLabels(roomReadings, new Set(eligible.map((plan) => plan.id)));
  const references = sourcePhotoReferences(retrieval, eligible);
  let planIds = eligible
    .filter(
      (plan) =>
        clearRooms.length > 0 &&
        clearRooms.every((reading) =>
          references.some(
            (reference) =>
              reference.planId === plan.id && labelKey(reference.label) === labelKey(reading.text),
          ),
        ) &&
        (!buildingLabels.length || (buildings.size === 1 && buildings.has(plan.building))) &&
        (!floors.size || (floors.size === 1 && floors.has(plan.floor))),
    )
    .map((plan) => plan.id);
  let gpsStatus: NonNullable<CampusPhotoAnalysis['gpsStatus']> = 'not-used';
  if (input.gps) {
    const age = Date.now() - input.gps.capturedAt;
    if (age < -5000 || age > 30000)
      throw new PhotoEvidenceError('The device reading expired. Request a fresh location reading.');
    if (input.gps.sourceSha256 !== locationCatalogue().geographicSource.sha256)
      throw new PhotoEvidenceError(
        'The device-location map changed. Reload before requesting location.',
      );
    const narrowed = planIds.filter((id) =>
      new Set<string>(input.gps!.buildings).has(eligible.find((plan) => plan.id === id)!.building),
    );
    gpsStatus = !input.gps.buildings.length
      ? 'outside-pilot'
      : planIds.length && !narrowed.length
        ? 'conflict'
        : 'used';
    planIds = narrowed;
  }
  const atDoor = clearRooms.filter((label) => label.placement === 'door');
  const anchorLabels = new Set(
    (atDoor.length
      ? atDoor
      : clearRooms.filter((label) => label.placement !== 'directional-sign')
    ).map((label) => labelKey(label.text)),
  );
  const anchor = anchorLabels.size === 1 ? [...anchorLabels][0] : undefined;
  const plan = planIds.length === 1 ? eligible.find((item) => item.id === planIds[0]) : undefined;
  const matches =
    plan && anchor
      ? references.filter(
          (reference) => reference.planId === plan.id && labelKey(reference.label) === anchor,
        )
      : [];
  const doors =
    plan && anchor
      ? pilotEvidence()
          .find((page) => page.plan.id === plan.id)!
          .drawnDoors.filter((door) => labelKey(door.room) === anchor)
      : [];
  let candidate: CampusLocationCandidate | undefined;
  if (
    plan &&
    matches.length === 1 &&
    !(atDoor.length && evidence.features?.visibleDoorCount === 0)
  ) {
    const door = doors.length === 1 ? doors[0] : undefined;
    candidate = {
      id: randomUUID(),
      planId: plan.id,
      sourceRef: plan.sourceRef,
      building: plan.building,
      floor: plan.floor,
      page: plan.page,
      bounds: door?.corridorBounds ?? null,
      ...(door
        ? {
            doorwayVicinity: {
              doorId: door.id,
              room: door.room,
              point: door.point,
              sourceSha256: plan.sourceSha256,
            },
          }
        : {}),
      confidence: 'low',
      verification: 'unverified-ai-hypothesis',
      sourceLabels: references.filter((reference) => reference.planId === plan.id),
      labelMatches: clearRooms.map((reading) => ({
        observedLabel: reading.text,
        planLabel: reading.text,
      })),
      matches: [
        {
          kind: 'printed-label',
          photoFeature: `Read label ${matches[0].label} in the submitted photo.`,
          planFeature: `Exact source label on ${plan.building}, floor ${plan.floor}.`,
        },
      ],
      limitations: [
        'The start is estimated from the extracted label and source records. Exact camera position and heading are unknown.',
        ...(doors.length > 1
          ? ['This room has multiple source doorways. A unique route start could not be selected.']
          : []),
      ],
    };
  }
  const summary = candidate
    ? `The extracted label ${anchor} matches ${candidate.building}, floor ${candidate.floor}. ${candidate.doorwayVicinity ? 'Its source doorway supplies an estimated starting vicinity.' : 'The source label is known, but a unique mapped doorway is unavailable.'}`
    : gpsStatus === 'outside-pilot' || gpsStatus === 'conflict'
      ? 'The selected device location does not agree with the source matches for this photo.'
      : 'The extracted labels do not identify one supported starting place.';
  const observations = [...evidence.observations];
  if (evidence.features?.visibleDoorCount != null)
    observations.push(
      `${evidence.features.visibleDoorCount} visible doorway(s) reported in the photo.`,
    );
  if (evidence.features?.windowsSide && evidence.features.windowsSide !== 'unknown')
    observations.push(
      `Window observation relative to the photo is ${evidence.features.windowsSide}.`,
    );
  if (evidence.features?.corridorShape && evidence.features.corridorShape !== 'unknown')
    observations.push(`The observed corridor shape is ${evidence.features.corridorShape}.`);
  const analysis: CampusPhotoAnalysis = {
    requestId: input.requestId,
    outcome: candidate ? 'candidates' : 'insufficient_evidence',
    observations,
    summary,
    clarification: candidate
      ? ''
      : 'Use a photo showing the room sign beside you. Enable device location only while standing where the photo was taken.',
    candidates: candidate ? [candidate] : [],
    referenceLabels: references,
    atlasPlanCount: 0,
    detailedPlanIds: plan ? [plan.id] : planIds,
    buildingHint: record.buildingHint ?? null,
    method: 'photo-label-retrieval',
    gpsStatus,
    evidenceId: evidence.id,
    labelRetrieval: {
      indexedLabels: retrieval.indexedLabels,
      exactMatchPlanIds: retrieval.clearMatchPlanIds,
      clearLabels: retrieval.clearLabels,
    },
    usedFallbackModel: evidence.usedFallbackModel,
    generatedAt: new Date().toISOString(),
  };
  session.campusAnalysis = analysis;
  session.campusLocation = candidate ?? null;
  session.notice = summary;
  session.agentStatus = 'Source lookup completed';
  logActivity(
    session,
    'locate_from_labels',
    candidate
      ? 'Resolved extracted evidence to a source-linked starting estimate.'
      : 'Extracted evidence did not identify a unique starting place.',
    plan ? [plan.sourceRef] : [],
    performance.now() - started,
  );
  return analysis;
}
