/** Resolve first-stage structured evidence against exact source records, without images or model calls. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CampusLocationCandidate, CampusPhotoAnalysis, Session } from '../src/types';
import { labelKey, pilotEvidence } from './pilot-evidence';
import { floorGraphs, sourceBuilding, landmarkKind } from './floor-graph';
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
          .array(z.string().refine((value) => sourceBuilding(value) === value))
          .max(visualPlans.length)
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
  const roomReadings = evidence.labels.filter(
    (label) => !label.kind || label.kind === 'room' || label.kind === 'landmark',
  );
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
      const building = sourceBuilding(label.text);
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
    (plan) => !record.buildingHint || plan.building === sourceBuilding(record.buildingHint),
  );
  const exact = new Set(
    roomReadings.filter((r) => r.clarity === 'clear').map((r) => labelKey(r.text)),
  );
  const landmarkLabels = new Set(
    roomReadings
      .filter((r) => r.kind === 'landmark' && r.clarity === 'clear')
      .map((r) => labelKey(r.text)),
  );
  const signMatches = (place: { label: string; kind: string }, sign: string) =>
    place.label === sign || (landmarkLabels.has(sign) && landmarkKind(sign) === place.kind);
  const floorMatches = (planId: string, sign: string) =>
    floorGraphs()
      .byId.get(planId)!
      .places.some((p) => signMatches(p, sign));
  const references = eligible.flatMap((plan) =>
    floorGraphs()
      .byId.get(plan.id)!
      .places.filter((place) => [...exact].some((sign) => signMatches(place, sign)))
      .map((place) => ({
        id: place.id,
        label: place.label,
        planId: plan.id,
        sourceSha256: plan.sourceSha256,
        bounds: place.bounds,
      })),
  );
  let planIds = eligible
    .filter(
      (plan) =>
        clearRooms.length > 0 &&
        clearRooms.every((reading) => floorMatches(plan.id, labelKey(reading.text))) &&
        (!buildingLabels.length || (buildings.size === 1 && buildings.has(plan.building))) &&
        (!floors.size || (floors.size === 1 && floors.has(plan.floor))),
    )
    .map((plan) => plan.id);
  let gpsStatus: NonNullable<CampusPhotoAnalysis['gpsStatus']> = 'not-used';
  if (input.gps) {
    const age = Date.now() - input.gps.capturedAt;
    if (age < -5000 || age > 30000)
      throw new PhotoEvidenceError('The device reading expired. Request a fresh location reading.');
    const geographic = locationCatalogue();
    if (input.gps.sourceSha256 !== geographic.geographicSource.sha256)
      throw new PhotoEvidenceError(
        'The device-location map changed. Reload before requesting location.',
      );
    const known = new Set(geographic.buildings.map((b) => b.building));
    const reported = new Set(input.gps.buildings);
    const narrowed = planIds.filter((id) => {
      const building = floorGraphs().byId.get(id)!.plan.building;
      return reported.has(building) || !known.has(building);
    });
    gpsStatus =
      !input.gps.buildings.length && narrowed.length
        ? 'not-used'
        : !input.gps.buildings.length
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

  const candidates: CampusLocationCandidate[] = [];
  if (anchorLabels.size && !(atDoor.length && evidence.features?.visibleDoorCount === 0)) {
    for (const plan of eligible.filter((p) => planIds.includes(p.id))) {
      const floor = floorGraphs().byId.get(plan.id)!;
      const matches = floor.places.filter((place) =>
        [...anchorLabels].some((sign) => signMatches(place, sign)),
      );
      for (const match of matches) {
        // A hand-transcribed doorway must also identify this particular occurrence.
        const anchor = match.label;
        const doors =
          pilotEvidence()
            .find((p) => p.plan.id === plan.id)
            ?.drawnDoors.filter((d) => labelKey(d.room) === anchor) ?? [];
        const door =
          matches.filter((p) => p.label === anchor).length === 1 && doors.length === 1
            ? doors[0]
            : undefined;
        candidates.push({
          id: randomUUID(),
          planId: plan.id,
          sourcePlaceId: match.id,
          sourceRef: plan.sourceRef,
          building: plan.building,
          floor: plan.floor,
          page: plan.page,
          confidence: 'low',
          verification: 'unverified-ai-hypothesis',
          anchorLabel: anchor,
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
          sourceLabels: references.filter(
            (ref) => ref.planId === plan.id && (ref.label !== anchor || ref.id === match.id),
          ),
          labelMatches: clearRooms.map((r) => ({
            observedLabel: r.text,
            planLabel: signMatches(match, labelKey(r.text)) ? match.label : r.text,
          })),
          matches: [
            {
              kind: 'printed-label',
              photoFeature: 'Read ' + anchor + ' in the photo.',
              planFeature: 'Matching label on ' + plan.building + ', floor ' + plan.floor + '.',
            },
          ],
          limitations: [
            'The photograph identifies a signed place. Exact camera position and heading are unknown.',
          ],
        });
      }
    }
  }
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  const summary = candidate
    ? `The extracted label ${candidate.anchorLabel} matches ${candidate.building}, floor ${candidate.floor}.`
    : candidates.length
      ? 'Several places match the signs in this photo. Select your starting location.'
      : gpsStatus === 'conflict' || gpsStatus === 'outside-pilot'
        ? 'The device reading does not agree with the photo matches.'
        : 'The extracted labels do not identify a starting place on the supplied floor plans.';
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
    outcome: candidates.length ? 'candidates' : 'insufficient_evidence',
    observations,
    summary,
    clarification: candidates.length
      ? ''
      : 'Use a photo showing the room sign beside you. Enable device location only while standing where the photo was taken.',
    candidates,
    referenceLabels: references,
    atlasPlanCount: 0,
    detailedPlanIds: planIds,
    buildingHint: record.buildingHint ?? null,
    method: 'photo-label-retrieval',
    gpsStatus,
    evidenceId: evidence.id,
    labelRetrieval: {
      indexedLabels: floorGraphs().places.length,
      exactMatchPlanIds: [...new Set(references.map((r) => r.planId))],
      clearLabels: [...exact],
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
    candidate ? [candidate.sourceRef] : [],
    performance.now() - started,
  );
  return analysis;
}
