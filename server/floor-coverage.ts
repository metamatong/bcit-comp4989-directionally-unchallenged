/** Inventory of the actual compiled assets, including sheets with no usable approaches. */
import { floorGraphs, visitorExclusion, type FloorPlace } from './floor-graph';
function hasWalkingApproach(place: FloorPlace) {
  return (
    !visitorExclusion(place) &&
    !!(
      place.cells.length ||
      place.terminalPaths?.length ||
      place.sharedAccess?.cells.length ||
      place.sharedAccess?.terminalPaths.length ||
      place.corridorVicinities?.length
    )
  );
}
export function floorCoverage() {
  return floorGraphs().ordered.map((floor) => {
    const places = floor.places;
    return {
      planId: floor.plan.id,
      sourceSha256: floor.plan.sourceSha256,
      sourceUrl: floor.plan.sourceUrl,
      placeOccurrences: places.length,
      floorComponentsWithPlaces: new Set(places.flatMap((p) => p.components)).size,
      withIdentifiedEndpoint: places.filter(
        (p) => hasWalkingApproach(p) || (!visitorExclusion(p) && p.doors.length),
      ).length,
      visitorRestricted: places.filter((p) => visitorExclusion(p) === 'staff-only').length,
      nonWalking: places.filter((p) => visitorExclusion(p) === 'non-walking').length,
      withDoorSymbols: places.filter((p) => p.doors.length > 0).length,
      withFloorApproach: places.filter(hasWalkingApproach).length,
      missingFloorApproach: places
        .filter((p) => !visitorExclusion(p) && !hasWalkingApproach(p))
        .map((p) => ({
          label: p.label,
          kind: p.kind,
          bounds: p.bounds,
          doorSymbols: p.doors.length,
          ...(p.visitorAccess ? { visitorAccess: p.visitorAccess } : {}),
        })),
    };
  });
}
