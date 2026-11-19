/** Match sign readings to source places without treating one uncorroborated reading as a veto. */
import type {
  CampusPhotoAnalysis,
  PhotoFeatures,
  PhotoLabelReading,
  PlanLabelReference,
} from '../src/types';
import {
  floorGraphs,
  landmarkKind,
  sourceBuilding,
  type FloorGraph,
  type FloorPlace,
} from './floor-graph';
import { labelKey, looksLikeIdentifier } from './pilot-evidence';
import type { SharedCorridor } from './shared-corridor';

type Sign = PhotoLabelReading;
type FloorReadings = { floor: FloorGraph; hits: Map<Sign, FloorPlace[]> };
export type StartMatch = {
  floor: FloorGraph;
  place: FloorPlace;
  observed: Sign;
  matched: { observedLabel: string; planLabel: string }[];
  unmatched: string[];
};
export type DeviceScope = { buildings: string[]; footprints: Set<string> };
const distinct = <T>(values: T[]) => [...new Set(values)];
const hasDirectionCue = (s: Sign) =>
  s.directionCue === 'arrow' || s.directionCue === 'directional-words';
const isLocalSign = (sign: Sign) => sign.placement !== 'directional-sign' && !hasDirectionCue(sign);
const keys = (signs: Sign[]) => distinct(signs.map((s) => labelKey(s.text)));

/** A room sign may include a descriptive type beside its exact printed room identifier. */
function placeLabel(sign: Sign) {
  const key = labelKey(sign.text);
  if (looksLikeIdentifier(key) || (sign.kind && sign.kind !== 'room')) return key;
  const tokens = key.split(' ');
  const identifiers = tokens.filter(looksLikeIdentifier);
  if (identifiers.length !== 1) return key;
  const identifierIndex = tokens.findIndex(looksLikeIdentifier);
  // Keep split prefixes/suffixes and other numeric tokens intact instead of truncating them.
  if (
    tokens.some(
      (token, index) => index !== identifierIndex && (!/^[A-Z]+$/.test(token) || token.length < 3),
    )
  )
    return key;
  return identifiers[0];
}

function describedPlaceKind(sign: Sign) {
  if (sign.kind && sign.kind !== 'room') return;
  return labelKey(sign.text).split(' ').includes('CLASSROOM') ? 'classroom' : undefined;
}

function matchesSign(place: FloorPlace, sign: Sign) {
  const key = placeLabel(sign);
  return place.label === key || (sign.kind === 'landmark' && landmarkKind(key) === place.kind);
}

function findReferences(floors: FloorReadings[]): PlanLabelReference[] {
  return floors.flatMap(({ floor, hits }) =>
    distinct([...hits.values()].flat()).map((place) => ({
      id: place.id,
      planId: place.planId,
      sourceSha256: floor.plan.sourceSha256,
      label: place.label,
      bounds: place.bounds,
    })),
  );
}

function matchingFloors(pages: FloorReadings[], signs: Sign[]) {
  return signs.length ? pages.filter((p) => signs.every((s) => p.hits.has(s))) : [];
}

function matchesOnFloor(
  { floor, hits }: FloorReadings,
  anchors: Sign[],
  signs: Sign[],
): StartMatch[] {
  const places = distinct(anchors.flatMap((s) => hits.get(s) ?? []));
  return places.map((place) => ({
    floor,
    place,
    observed: anchors.find((s) => hits.get(s)?.includes(place))!,
    matched: signs.flatMap((sign) => {
      const linked = hits.get(sign);
      if (!linked?.length) return [];
      const reading = linked.includes(place)
        ? place
        : (linked.find((p) => p.label === placeLabel(sign)) ??
          (linked.length === 1 ? linked[0] : undefined));
      // A generic sign may match different stair codes. Only name a specific one when grounded.
      return reading ? [{ observedLabel: sign.text, planLabel: reading.label }] : [];
    }),
    unmatched: keys(signs.filter((s) => !hits.has(s))),
  }));
}

type CorridorMatch = {
  page: FloorReadings;
  area: SharedCorridor;
  needsConfirmation: boolean;
  unmatched: string[];
  matched: StartMatch['matched'];
};

function commonCorridor(
  pages: FloorReadings[],
  scope: FloorReadings[],
  readings: Sign[],
  features?: PhotoFeatures,
): CorridorMatch | undefined {
  if (
    features?.visibleDoorCount === 0 ||
    features?.corridorShape === 'junction' ||
    features?.corridorShape === 'turn'
  )
    return;
  // A projecting room plaque can be classified as a direction sign even when
  // the provider supplied no evidence of an arrow. This can pose a question only.
  const hallway = features?.corridorShape === 'straight' && (features.visibleDoorCount ?? 0) > 0;
  const usable = readings.filter((s) => !hasDirectionCue(s) && (isLocalSign(s) || hallway));
  const allRoomSigns = usable.filter((s) => !s.kind || s.kind === 'room');
  const roomLabels = distinct(allRoomSigns.map(placeLabel));
  if (roomLabels.length < 2) return;
  const supported = usable.filter((s) => pages.some((p) => p.hits.has(s)));
  const possible = matchingFloors(scope, supported);
  if (possible.length !== 1) return;
  const page = possible[0],
    rooms: FloorPlace[] = [];
  const roomSigns = supported.filter((s) => !s.kind || s.kind === 'room');
  for (const key of distinct(roomSigns.map(placeLabel))) {
    const occurrences = page.floor.places.filter((p) => p.label === key);
    if (occurrences.length !== 1) return;
    rooms.push(occurrences[0]);
  }
  const area = page.floor.frontages.match(rooms);
  if (!area) return;
  const unmatched = keys(usable.filter((s) => !page.hits.has(s)));
  const needsConfirmation =
    unmatched.length > 0 ||
    roomSigns.some((s) => s.placement !== 'door' || s.directionCue === 'unclear');
  const matched = supported.flatMap((sign) => {
    const places = page.hits.get(sign) ?? [];
    const p =
      places.find((p) => p.label === placeLabel(sign)) ??
      (places.length === 1 ? places[0] : undefined);
    return p ? [{ observedLabel: sign.text, planLabel: p.label }] : [];
  });
  return { page, area, needsConfirmation, unmatched, matched };
}

export function resolveStartingSigns(
  labels: Sign[],
  buildingHint?: string | null,
  device?: DeviceScope,
  features?: PhotoFeatures,
) {
  const graphs = floorGraphs();
  const clear = labels.filter((s) => s.clarity === 'clear');
  const readings = clear.filter((s) => !s.kind || s.kind === 'room' || s.kind === 'landmark');
  const local = readings.filter(isLocalSign);
  const buildings = clear.filter((s) => s.kind === 'building' && isLocalSign(s));
  const floors = clear.filter((s) => s.kind === 'floor' && isLocalSign(s));
  const describedKinds = new Map<Sign, string>();
  for (const sign of readings) {
    const kind = describedPlaceKind(sign);
    const label = placeLabel(sign);
    if (
      kind &&
      graphs.ordered.some((floor) =>
        floor.places.some((place) => place.label === label && place.kind === kind),
      )
    )
      describedKinds.set(sign, kind);
  }
  const pages: FloorReadings[] = graphs.ordered.map((floor) => {
    const hits = new Map<Sign, FloorPlace[]>();
    for (const sign of readings) {
      const describedKind = describedKinds.get(sign);
      const places = floor.places.filter(
        (p) => matchesSign(p, sign) && (!describedKind || p.kind === describedKind),
      );
      if (places.length) hits.set(sign, places);
    }
    return { floor, hits };
  });
  const constrained = pages.filter(
    ({ floor: { plan } }) =>
      (!buildingHint || sourceBuilding(buildingHint) === plan.building) &&
      buildings.every((b) => sourceBuilding(b.text) === plan.building) &&
      floors.every((f) => labelKey(f.text) === plan.floor),
  );
  // Apply a fresh optional building observation independently of sign agreement.
  // An empty GIS result cannot exclude buildings missing from the footprint source.
  const scope = constrained.filter(
    ({ floor: { plan } }) =>
      !device ||
      (device.buildings.length
        ? device.buildings.includes(plan.building)
        : !device.footprints.has(plan.building)),
  );
  const inScope = local.filter((s) => scope.some((p) => p.hits.has(s)));
  const doors = inScope.filter((s) => s.placement === 'door');
  const anchors = doors.length ? doors : inScope;
  let possible = matchingFloors(scope, inScope);
  if (!possible.length && doors.length) possible = matchingFloors(scope, doors);

  // Don't substitute a background room for a grounded door that contradicts the building/floor.
  const contradictedDoor =
    !doors.length && local.some((s) => s.placement === 'door' && pages.some((p) => p.hits.has(s)));
  if (contradictedDoor) possible = [];
  const corridor = contradictedDoor ? undefined : commonCorridor(pages, scope, readings, features);
  if (corridor) possible = [corridor.page];
  const matches = corridor ? [] : possible.flatMap((page) => matchesOnFloor(page, anchors, local));
  const partial = corridor
    ? corridor.unmatched.length > 0
    : matches.some((m) => m.unmatched.length > 0);
  const references = findReferences(possible.length ? possible : scope);
  const gpsConflict =
    !!device?.buildings.length &&
    (((!!buildingHint || buildings.length > 0 || floors.length > 0) && !scope.length) ||
      (constrained.some((p) => local.some((s) => p.hits.has(s))) && !inScope.length) ||
      contradictedDoor);
  let gpsStatus: NonNullable<CampusPhotoAnalysis['gpsStatus']> = 'not-used';
  if (device) {
    if (!device.buildings.length) gpsStatus = inScope.length ? 'not-used' : 'outside-pilot';
    else if (gpsConflict) gpsStatus = 'conflict';
    else gpsStatus = corridor || matches.length ? 'used' : 'building-only';
  }
  return {
    matches,
    corridor,
    directionalOnly: readings.length > 0 && !local.length,
    partial,
    references,
    gpsStatus,
    planIds: possible.map((p) => p.floor.plan.id),
    clearLabels: keys(readings),
    unmappedLabels: keys(local.filter((s) => !pages.some((p) => p.hits.has(s)))),
    exactMatchPlanIds: pages.filter((p) => p.hits.size).map((p) => p.floor.plan.id),
  };
}
