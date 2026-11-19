/** Recheck a visitor-selected public cell against the current source and walking graph. */
import { z } from 'zod';
import type { CampusLocationCandidate } from '../src/types';
import { mapDestinationScope, type FloorPin } from '../src/wayfinding';
import { floorGraphs } from './floor-graph';
import type { FloorSearch, SearchStop } from './floor-search';
import { TopologyError } from './topology';

export const pinSchema = z
  .object({
    planId: z.string().min(1).max(100),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    graphVersion: z.string().regex(/^[a-f0-9]{16}$/),
    point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  })
  .strict();

export function pointFloor(
  candidate: CampusLocationCandidate,
  role: 'origin' | 'destination',
  destination: string,
  planId: string,
) {
  const floor = floorGraphs().byId.get(planId);
  const scope = mapDestinationScope(destination);
  if (role === 'destination' && !scope)
    throw new TopologyError(
      'Named destinations use their mapped entrances. Choose Map point for a custom destination.',
      400,
    );
  if (
    !floorGraphs()
      .byId.get(candidate.planId)
      ?.places.some((p) => p.id === candidate.sourcePlaceId) ||
    !floor ||
    (role === 'origin'
      ? planId !== candidate.planId
      : (scope?.building && floor.plan.building !== scope.building) ||
        (scope?.floor && floor.plan.floor !== scope.floor))
  )
    throw new TopologyError('Choose a point on the floor identified for this trip.', 400);
  return floor;
}

export function pinnedStop(
  candidate: CampusLocationCandidate,
  role: 'origin' | 'destination',
  destination: string,
  pin: FloorPin,
  search: FloorSearch,
): SearchStop {
  const floor = pointFloor(candidate, role, destination, pin.planId);
  if (pin.graphVersion !== floor.version || pin.sourceSha256 !== floor.plan.sourceSha256)
    throw new TopologyError('The floor map changed. Select the point again.', 409);
  const cell = floor.containingCell(pin.point);
  const label = role === 'origin' ? 'Selected starting point' : 'Selected destination';
  if (cell !== undefined) return { key: cell, stop: floor.stop(cell, label) };
  const access = floor.interiorAt(pin.point);
  if (access) return search.terminal(pin.planId, label, access.cell, access.path);
  throw new TopologyError('Choose a point in the shaded walking area.', 400);
}
