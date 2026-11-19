/** Resolve the current image-free receipt to source occurrences and optional visitor choices. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CampusLocationCandidate,
  CampusPhotoAnalysis,
  PhotoEvidence,
  Session,
} from '../src/types';
import { labelKey, pilotEvidence } from './pilot-evidence';
import { floorGraphs } from './floor-graph';
import { PhotoEvidenceError, type PhotoEvidenceRecord } from './photo-evidence';
import { gpsContextSchema } from './gps-context';
import { locationCatalogue } from './geolocation';
import { logActivity } from './session';
import { resolveStartingSigns, type StartMatch, type DeviceScope } from './starting-place-evidence';

export const labelLocationRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    evidenceId: z.string().uuid(),
    gps: gpsContextSchema.optional(),
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

function deviceScope(gps: LabelLocationRequest['gps']): DeviceScope | undefined {
  if (!gps) return;
  const age = Date.now() - gps.capturedAt;
  if (age < -5000 || age > 30000)
    throw new PhotoEvidenceError('The device reading expired. Request a fresh location reading.');
  const catalogue = locationCatalogue();
  if (gps.sourceSha256 !== catalogue.geographicSource.sha256)
    throw new PhotoEvidenceError(
      'The device-location map changed. Reload before requesting location.',
    );
  return {
    buildings: gps.buildings,
    footprints: new Set(catalogue.buildings.map((b) => b.building)),
  };
}

function observations(evidence: PhotoEvidence) {
  const values = [...evidence.observations],
    f = evidence.features;
  if (f?.visibleDoorCount != null)
    values.push(`${f.visibleDoorCount} visible doorway(s) reported in the photo.`);
  if (f?.windowsSide && f.windowsSide !== 'unknown')
    values.push(`Window observation relative to the photo is ${f.windowsSide}.`);
  if (f?.corridorShape && f.corridorShape !== 'unknown')
    values.push(`The observed corridor shape is ${f.corridorShape}.`);
  return values;
}

type Resolution = ReturnType<typeof resolveStartingSigns>;
export function candidateFromSignMatch(
  match: StartMatch,
  references: Resolution['references'],
): CampusLocationCandidate {
  const { floor, place } = match,
    plan = floor.plan;
  const doors =
    pilotEvidence()
      .find((p) => p.plan.id === plan.id)
      ?.drawnDoors.filter((d) => labelKey(d.room) === place.label) ?? [];
  const door =
    doors.length === 1 && floor.places.filter((p) => p.label === place.label).length === 1
      ? doors[0]
      : undefined;
  return {
    id: randomUUID(),
    planId: plan.id,
    sourcePlaceId: place.id,
    sourceRef: plan.sourceRef,
    building: plan.building,
    floor: plan.floor,
    page: plan.page,
    confidence: 'low',
    verification: 'unverified-ai-hypothesis',
    anchorLabel: place.label,
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
      (ref) => ref.planId === plan.id && (ref.label !== place.label || ref.id === place.id),
    ),
    labelMatches: match.matched,
    matches: [
      {
        kind: 'printed-label',
        photoFeature: 'Read ' + match.observed.text + ' in the photo.',
        planFeature: 'Matching sign on ' + plan.building + ', floor ' + plan.floor + '.',
      },
    ],
    limitations: [
      'The exact camera position and heading are unknown.',
      ...(match.unmatched.length
        ? [
            'Other photo readings without a match on this floor: ' +
              match.unmatched.join(', ') +
              '.',
          ]
        : []),
    ],
  };
}
function corridorCandidate(
  match: NonNullable<Resolution['corridor']>,
  references: Resolution['references'],
): CampusLocationCandidate {
  const {
    area,
    page: {
      floor: { plan },
    },
  } = match;
  return {
    id: randomUUID(),
    planId: plan.id,
    building: plan.building,
    floor: plan.floor,
    page: plan.page,
    sourceRef: plan.sourceRef,
    sourcePlaceId: area.corridor.id,
    anchorLabel: area.label,
    confidence: 'low',
    verification: 'unverified-ai-hypothesis',
    bounds: area.bounds,
    sourceLabels: references.filter((r) => r.planId === plan.id),
    labelMatches: match.matched,
    corridorOrigin: {
      bandId: area.id,
      roomPlaceIds: area.rooms.map((p) => p.id),
      roomLabels: area.rooms.map((p) => p.label),
      needsConfirmation: match.needsConfirmation,
    },
    matches: [
      {
        kind: 'printed-label',
        photoFeature: 'Visible room signs ' + area.rooms.map((p) => p.label).join(', ') + '.',
        planFeature:
          'The marked entrances face the same stretch of corridor ' + area.corridor.label + '.',
      },
    ],
    limitations: [
      'The map marks a walking reference within this corridor. Exact camera position and heading are unknown.',
      ...(match.unmatched.length
        ? ['Additional readings without a floor-plan match: ' + match.unmatched.join(', ') + '.']
        : []),
    ],
  };
}

function describe(result: Resolution, candidates: CampusLocationCandidate[], device?: DeviceScope) {
  const names = device?.buildings.join(', ');
  if (result.corridor && candidates.length) {
    const { area, needsConfirmation, unmatched } = result.corridor;
    const summary =
      'The marked rooms face corridor ' +
      area.corridor.label +
      ' on floor ' +
      result.corridor.page.floor.plan.floor +
      '.';
    return {
      summary:
        summary +
        (unmatched.length
          ? ' Additional readings without a match: ' + unmatched.join(', ') + '.'
          : '') +
        (needsConfirmation ? ' Confirm that you are beside these rooms.' : ''),
      clarification: '',
    };
  }
  if (candidates.length && result.partial) {
    const gaps = result.unmappedLabels.length
      ? `No floor-plan match for ${result.unmappedLabels.map((l) => '“' + l + '”').join(', ')}.`
      : 'The signs do not all match the same floor plan.';
    return { summary: gaps + ' Confirm the sign beside you to start.', clarification: '' };
  }
  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      summary: `The extracted label ${c.anchorLabel} matches ${c.building}, floor ${c.floor}.`,
      clarification: '',
    };
  }
  if (candidates.length)
    return {
      summary: 'Several places match the signs in this photo. Select your starting location.',
      clarification: '',
    };
  if (result.gpsStatus === 'building-only')
    return {
      summary: `Device location points to ${names}. A floor and starting place could not be established from the signs.`,
      clarification: 'Use a closer photo of the room or stair sign beside you.',
    };
  if (result.gpsStatus === 'conflict' || result.gpsStatus === 'outside-pilot')
    return {
      summary: 'The device reading does not agree with the photo matches.',
      clarification: 'Check that you are at the photographed location or use a clearer sign.',
    };
  if (result.directionalOnly && result.references.length)
    return {
      summary:
        'The room numbers match the plans, but direction signs can point to rooms elsewhere.',
      clarification: 'Use an identifying sign on or beside a nearby doorway.',
    };
  return {
    summary: 'The extracted labels do not identify a starting place on the supplied floor plans.',
    clarification:
      'Use a photo showing the room sign beside you. Enable device location only while standing where the photo was taken.',
  };
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
  const started = performance.now(),
    evidence = record.evidence,
    device = deviceScope(input.gps);
  const result = resolveStartingSigns(
    evidence.labels,
    record.buildingHint,
    device,
    evidence.features,
  );
  const contradictoryDoorCount =
    evidence.features?.visibleDoorCount === 0 &&
    evidence.labels.some(
      (s) =>
        (!s.kind || s.kind === 'room' || s.kind === 'landmark') &&
        s.clarity === 'clear' &&
        s.placement === 'door',
    );
  const candidates = contradictoryDoorCount
    ? []
    : result.corridor
      ? [corridorCandidate(result.corridor, result.references)]
      : result.matches.map((m) => candidateFromSignMatch(m, result.references));
  if (!candidates.length && result.gpsStatus === 'used') result.gpsStatus = 'building-only';
  const candidate =
    !result.partial && !result.corridor?.needsConfirmation && candidates.length === 1
      ? candidates[0]
      : undefined;
  const { summary, clarification } = describe(result, candidates, device);
  const analysis: CampusPhotoAnalysis = {
    requestId: input.requestId,
    outcome: candidates.length ? 'candidates' : 'insufficient_evidence',
    observations: observations(evidence),
    summary,
    clarification,
    candidates,
    referenceLabels: result.references,
    atlasPlanCount: 0,
    detailedPlanIds: result.planIds,
    buildingHint: record.buildingHint ?? null,
    method: 'photo-label-retrieval',
    gpsStatus: result.gpsStatus,
    deviceBuildings: device?.buildings,
    evidenceId: evidence.id,
    labelRetrieval: {
      indexedLabels: floorGraphs().places.length,
      clearLabels: result.clearLabels,
      exactMatchPlanIds: result.exactMatchPlanIds,
      unmatchedLabels: result.unmappedLabels,
      partial: result.partial && candidates.length > 0,
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
      : candidates.length
        ? 'Offered source matches for visitor confirmation.'
        : 'The evidence did not establish a starting place.',
    candidate ? [candidate.sourceRef] : [],
    performance.now() - started,
  );
  return analysis;
}
