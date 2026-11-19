/** Source-backed common corridor regions for distinct room signs on opposite frontages. */
import { z } from 'zod';
import type { PlanBounds, VisualPlan } from '../src/types';
import type { FloorGraph, FloorPlace } from './floor-graph';
import type { FloorSearch, SearchStop } from './floor-search';
import { boundsSchema } from './visual-data';

const index = z.number().int().nonnegative();
export const corridorBandSchema = z.object({
  corridor: index,
  axis: z.enum(['x', 'y']),
  bounds: boundsSchema,
  members: z.array(z.tuple([index, z.union([z.literal(-1), z.literal(1)]), index, index])).min(2),
  spine: z.array(index).min(1),
});
type BandData = z.infer<typeof corridorBandSchema>;
type Front = { side: number; first: number; last: number };
type Band = {
  id: string;
  corridor: FloorPlace;
  axis: 'x' | 'y';
  bounds: PlanBounds;
  members: Map<string, Front>;
  spine: number[];
};
export type SharedCorridor = {
  id: string;
  corridor: FloorPlace;
  rooms: FloorPlace[];
  cell: number;
  bounds: PlanBounds;
  label: string;
};

/** Show one corridor for several possible room doors only if their verified first
 * walking segments actually overlap in the same direction up to the same turn. */
export function commonDoorDeparture(
  floor: FloorGraph,
  room: FloorPlace,
  starts: SearchStop[],
  goals: SearchStop[],
  search: FloorSearch,
  preferElevators = false,
) {
  if (
    starts.length < 2 ||
    room.sharedEntry ||
    !starts.every(
      (s) =>
        s.key >= 0 &&
        !s.unlinked &&
        !s.stop.corridorVicinity &&
        !s.stop.sharedEntrance &&
        room.doors.some((d) => d[2] !== null && floor.offset + d[2] === s.key),
    )
  )
    return;
  const positions = starts.map((s) => s.stop.point);
  if (
    !positions.every((p) => p.x === positions[0].x) &&
    !positions.every((p) => p.y === positions[0].y)
  )
    return;
  const routes = starts.map((s) => search.route([s], goals, preferElevators));
  const first = routes[0]?.steps[0];
  if (first?.kind !== 'corridor' || first.path.length < 2) return;
  const turn = first.path[1],
    dx = turn.x - first.path[0].x,
    dy = turn.y - first.path[0].y;
  let longest = -1;
  let furthest = 0;
  for (const [i, r] of routes.entries()) {
    const step = r?.steps[0];
    if (
      step?.kind !== 'corridor' ||
      step.path.length < 2 ||
      step.from.planId !== floor.plan.id ||
      step.path[1].x !== turn.x ||
      step.path[1].y !== turn.y
    )
      return;
    const x = turn.x - step.path[0].x,
      y = turn.y - step.path[0].y;
    if (Math.abs(x * dy - y * dx) > 1e-10 || x * dx + y * dy <= 0) return;
    const length = Math.hypot(x * floor.plan.width, y * floor.plan.height);
    if (length > longest) {
      longest = length;
      furthest = i;
    }
  }
  const r = routes[furthest]!;
  const xs = positions.map((p) => p.x),
    ys = positions.map((p) => p.y);
  const padX = floor.step / (2 * floor.plan.width),
    padY = floor.step / (2 * floor.plan.height);
  const bounds: PlanBounds = [
    Math.max(0, Math.min(...xs) - padX),
    Math.max(0, Math.min(...ys) - padY),
    Math.min(1, Math.max(...xs) + padX),
    Math.min(1, Math.max(...ys) + padY),
  ];
  const origin = { ...r.origin, label: 'Corridor outside room ' + room.label, startRegion: bounds };
  return { ...r, origin, steps: [{ ...r.steps[0], from: origin }, ...r.steps.slice(1)] };
}

export class CorridorFrontages {
  private readonly bands: Band[];
  constructor(
    data: BandData[],
    places: FloorPlace[],
    private plan: VisualPlan,
    private width: number,
    private step: number,
    private offset: number,
    version: string,
    validateCell: (local: number) => number,
  ) {
    this.bands = data.map((band, i) => {
      const corridor = places[band.corridor],
        members = new Map<string, Front>();
      if (corridor?.kind !== 'corridor')
        throw Error('Missing source corridor occurrence on ' + plan.id);
      for (const [placeIndex, side, first, last] of band.members) {
        const place = places[placeIndex];
        if (
          !place ||
          !place.doors.some((d) => d[2] !== null) ||
          members.has(place.id) ||
          first > last
        )
          throw Error('Invalid room frontage on ' + plan.id);
        members.set(place.id, { side, first, last });
      }
      return {
        ...band,
        id: plan.id + ':' + version + ':band:' + i,
        corridor,
        members,
        spine: band.spine.map(validateCell),
      };
    });
  }

  /** A common connected floor or a pair of printed label centres is insufficient. */
  match(places: FloorPlace[]): SharedCorridor | undefined {
    if (places.length < 2 || new Set(places.map((p) => p.label)).size !== places.length) return;
    const rooms = [...places].sort((a, b) => a.label.localeCompare(b.label));
    const matches = this.bands.flatMap((band) => {
      const fronts = rooms.flatMap((p) => band.members.get(p.id) ?? []);
      if (fronts.length !== rooms.length || new Set(fronts.map((f) => f.side)).size !== 2)
        return [];
      const lo = Math.max(...fronts.map((f) => f.first)),
        hi = Math.min(...fronts.map((f) => f.last));
      const horizontal = band.axis === 'x';
      const inside = band.spine.filter((id) => {
        const local = id - this.offset,
          k = horizontal ? local % this.width : Math.floor(local / this.width);
        return k >= lo && k <= hi;
      });
      if (!inside.length) return [];
      const bounds: PlanBounds = [...band.bounds];
      const axis = horizontal ? 0 : 1;
      const fraction = this.step / (horizontal ? this.plan.width : this.plan.height);
      bounds[axis] = Math.max(bounds[axis], lo * fraction);
      bounds[axis + 2] = Math.min(bounds[axis + 2], (hi + 1) * fraction);
      const names = rooms.map((p) => p.label);
      const label =
        'Corridor ' +
        band.corridor.label +
        (names.length === 2 ? ' between ' + names.join(' and ') : ' by ' + names.join(', '));
      return [
        {
          id: band.id,
          corridor: band.corridor,
          rooms,
          cell: inside[Math.floor((inside.length - 1) / 2)],
          bounds,
          label,
        },
      ];
    });
    return matches.length === 1 ? matches[0] : undefined;
  }
}
