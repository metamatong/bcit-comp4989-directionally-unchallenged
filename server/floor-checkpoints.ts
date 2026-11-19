/** Reference stops on the requested sheet. The printed room position only ranks
 * actual signed public stops; it is never a point in the calculated walking path. */
import { visitorExclusion, type FloorGraph, type FloorPlace } from './floor-graph';
import type { FloorSearch, SearchStop, VisitorMap } from './floor-search';

export function reachableFloorCheckpoint(
  floor: FloorGraph,
  room: FloorPlace,
  reachable: Set<number>,
  map: VisitorMap,
  search: FloorSearch,
) {
  const choices: SearchStop[] = [];
  for (const place of floor.places) {
    if (
      place.id === room.id ||
      visitorExclusion(place) ||
      !/\d/.test(place.label) ||
      !['corridor', 'atrium'].includes(place.kind)
    )
      continue;
    for (const cell of place.cells)
      if (reachable.has(cell)) {
        choices.push({
          key: cell,
          stop: floor.stop(
            cell,
            place.kind === 'atrium' ? 'Atrium ' + place.label : 'Corridor ' + place.label,
          ),
        });
      }
  }
  for (const edge of map.doc.edges) {
    if (!map.network.allowed.has(edge.id) || edge.kind === 'corridor') continue;
    for (const id of [edge.fromNodeId, edge.toNodeId]) {
      const node = search.reviewed(id);
      if (node?.stop.planId === floor.plan.id && reachable.has(node.key)) choices.push(node);
    }
  }
  const [left, top, right, bottom] = room.bounds;
  const score = ({ stop }: SearchStop) =>
    Math.hypot(
      Math.max(left - stop.point.x, 0, stop.point.x - right) * floor.plan.width,
      Math.max(top - stop.point.y, 0, stop.point.y - bottom) * floor.plan.height,
    );
  return choices.sort((a, b) => score(a) - score(b) || a.stop.label.localeCompare(b.stop.label))[0];
}
