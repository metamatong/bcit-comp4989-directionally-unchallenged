/** Inventory of the actual compiled assets, including sheets with no usable approaches. */
import { floorGraphs } from './floor-graph';
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
        (p) => p.cells.length || p.doors.length || p.terminalPaths?.length,
      ).length,
      visitorRestricted: places.filter((p) => p.visitorAccess).length,
      withDoorSymbols: places.filter((p) => p.doors.length > 0).length,
      withFloorApproach: places.filter((p) => p.cells.length > 0 || p.terminalPaths?.length).length,
      missingFloorApproach: places
        .filter((p) => !p.cells.length && !p.terminalPaths?.length)
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
