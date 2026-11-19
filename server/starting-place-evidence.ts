/** Match sign readings to source places without treating one uncorroborated reading as a veto. */
import type { CampusPhotoAnalysis, PhotoLabelReading, PlanLabelReference } from '../src/types';
import {
  floorGraphs,
  landmarkKind,
  sourceBuilding,
  type FloorGraph,
  type FloorPlace,
} from './floor-graph';
import { labelKey } from './pilot-evidence';

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
const isLocalSign = (sign: Sign) => sign.placement !== 'directional-sign';
const keys = (signs: Sign[]) => distinct(signs.map((s) => labelKey(s.text)));

function matchesSign(place: FloorPlace, sign: Sign) {
  const key = labelKey(sign.text);
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
        : (linked.find((p) => p.label === labelKey(sign.text)) ??
          (linked.length === 1 ? linked[0] : undefined));
      // A generic sign may match different stair codes. Only name a specific one when grounded.
      return reading ? [{ observedLabel: sign.text, planLabel: reading.label }] : [];
    }),
    unmatched: keys(signs.filter((s) => !hits.has(s))),
  }));
}

export function resolveStartingSigns(
  labels: Sign[],
  buildingHint?: string | null,
  device?: DeviceScope,
) {
  const graphs = floorGraphs();
  const clear = labels.filter((s) => s.clarity === 'clear');
  const readings = clear.filter((s) => !s.kind || s.kind === 'room' || s.kind === 'landmark');
  const local = readings.filter(isLocalSign);
  const buildings = clear.filter((s) => s.kind === 'building' && isLocalSign(s));
  const floors = clear.filter((s) => s.kind === 'floor' && isLocalSign(s));
  const pages: FloorReadings[] = graphs.ordered.map((floor) => {
    const hits = new Map<Sign, FloorPlace[]>();
    for (const sign of readings) {
      const places = floor.places.filter((p) => matchesSign(p, sign));
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
  const matches = possible.flatMap((page) => matchesOnFloor(page, anchors, local));
  const partial = matches.some((m) => m.unmatched.length > 0);
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
    else gpsStatus = matches.length ? 'used' : 'building-only';
  }
  return {
    matches,
    partial,
    references,
    gpsStatus,
    planIds: possible.map((p) => p.floor.plan.id),
    clearLabels: keys(readings),
    unmappedLabels: keys(local.filter((s) => !pages.some((p) => p.hits.has(s)))),
    exactMatchPlanIds: pages.filter((p) => p.hits.size).map((p) => p.floor.plan.id),
  };
}
