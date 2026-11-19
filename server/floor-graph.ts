/** Source-bound place occurrences and precomputed walkable cells on every supplied floor. */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './data';
import { boundsSchema, visualPlans } from './visual-data';
import type { VisualPlan } from '../src/types';
import type { TopologyNode } from '../src/topology';
import type { MapStop, PagePoint } from '../src/wayfinding';
import { FloorInterior, interiorSchema } from './floor-interior';
import { CorridorFrontages, corridorBandSchema } from './shared-corridor';

const index = z.number().int().nonnegative();
const unit = z.number().min(0).max(1);
const pagePair = z.tuple([unit, unit]);
const reviewedPointSchema = z.object({
  nodeId: z.string().uuid(),
  version: index.positive(),
  point: pagePair,
});
const placeSchema = z.object({
  label: z.string().min(1),
  kind: z.string().min(1),
  method: z.enum(['transcription', 'pdf-text', 'repeated-ocr']),
  components: z.array(index),
  bounds: boundsSchema,
  doors: z.array(z.tuple([unit, unit, index.nullable()])),
  cells: z.array(index),
  reviewedLanding: reviewedPointSchema.optional(),
  reviewedDoor: reviewedPointSchema.optional(),
  sharedEntry: z.boolean().optional(),
  sharedHost: z.string().min(1).optional(),
  visitorAccess: z.literal('staff-only').optional(),
  roomArea: z.boolean().optional(),
  terminalPaths: z.array(z.object({ cell: index, via: z.array(pagePair).min(2) })).optional(),
});
const floorSchema = z.object({
  id: z.string(),
  sourceSha256: z.string(),
  geometrySha256: z.string(),
  width: index.positive(),
  height: index.positive(),
  step: z.number().positive(),
  runs: z.array(z.tuple([index, index, index])),
  portals: z.array(
    z.tuple([index, index, z.tuple([unit, unit]), z.tuple([unit, unit]), z.tuple([unit, unit])]),
  ),
  ties: z.array(z.tuple([unit, unit, index])),
  landingApproaches: z
    .array(
      z.object({
        nodeId: z.string().uuid(),
        version: index.positive(),
        landing: pagePair,
        cell: index,
        via: z.array(pagePair).max(2),
      }),
    )
    .optional(),
  interiorAccess: interiorSchema.optional(),
  places: z.array(placeSchema),
  corridorBands: z.array(corridorBandSchema).optional(),
});
export type FloorPlace = z.infer<typeof placeSchema> & { id: string; planId: string };
/** Only generic landmark names use aliases. Numbered place identifiers always match in full. */
const landmarkNames = new Map([
  ['STAIR', 'stairs'],
  ['STAIRS', 'stairs'],
  ['STAIRWAY', 'stairs'],
  ['STAIRWELL', 'stairs'],
  ['ELEVATOR', 'elevator'],
  ['ELEV', 'elevator'],
  ['LIFT', 'elevator'],
  ['CORRIDOR', 'corridor'],
  ['HALLWAY', 'corridor'],
]);
export function landmarkKind(label: string) {
  return landmarkNames.get(label);
}
export const floorStride = 2 ** 22;
export const pointKey = (p: PagePoint) => p.x + ',' + p.y;
export class FloorGraph {
  readonly places: FloorPlace[];
  readonly frontages: CorridorFrontages;
  readonly interior?: FloorInterior;
  readonly ties = new Map<string, number>();
  readonly portals = new Map<number, { cell: number; opening: PagePoint[] }[]>();
  readonly offset: number;
  readonly width: number;
  readonly step: number;
  readonly runs: [number, number, number][];
  private readonly cells: Uint8Array;
  private readonly stairDoors = new Map<
    string,
    { version: number; point: PagePoint; cell: number; via: PagePoint[] }
  >();

  constructor(
    public readonly plan: VisualPlan,
    data: z.infer<typeof floorSchema>,
    position: number,
    readonly version: string,
  ) {
    const { width, height, step } = data;
    this.width = width;
    this.step = step;
    this.runs = data.runs;
    this.offset = position * floorStride;
    if (
      data.sourceSha256 !== plan.sourceSha256 ||
      data.geometrySha256 !== plan.geometry.sha256 ||
      width * height >= floorStride ||
      ![1, 2].includes(step) ||
      width !== Math.floor(Math.ceil(plan.width * 2) / (2 * step)) ||
      height !== Math.floor(Math.ceil(plan.height * 2) / (2 * step))
    )
      throw Error('Floor graph needs to be regenerated for ' + plan.id);
    this.cells = new Uint8Array(width * height);
    for (const [y, left, right] of data.runs) {
      if (y >= height || left > right || right >= width)
        throw Error('Invalid floor span on ' + plan.id);
      this.cells.fill(1, y * width + left, y * width + right + 1);
    }
    if (data.interiorAccess)
      this.interior = new FloorInterior(data.interiorAccess, width, this.cells);
    const valid = (cell: number) => {
      if (!this.cells[cell]) throw Error('Unwalkable access on ' + plan.id);
      return cell + this.offset;
    };
    this.places = data.places.map((place, i) => ({
      ...place,
      planId: plan.id,
      id: plan.id + ':' + version + ':place:' + i,
      cells: place.cells.map(valid),
      terminalPaths: place.terminalPaths?.map((path) => {
        const cell = valid(path.cell);
        const end = this.point(cell);
        const last = path.via.at(-1)!;
        if (Math.abs(end.x - last[0]) > 1e-6 || Math.abs(end.y - last[1]) > 1e-6)
          throw Error('Suite access must end at its public walking cell on ' + plan.id);
        return { ...path, cell };
      }),
    }));
    this.frontages = new CorridorFrontages(
      data.corridorBands ?? [],
      this.places,
      plan,
      width,
      step,
      this.offset,
      version,
      valid,
    );
    for (const entry of data.landingApproaches ?? []) {
      if (this.stairDoors.has(entry.nodeId)) throw Error('Duplicate stair approach on ' + plan.id);
      const [x, y] = entry.landing;
      this.stairDoors.set(entry.nodeId, {
        version: entry.version,
        point: { x, y },
        cell: valid(entry.cell),
        via: entry.via.map(([x, y]) => ({ x, y })),
      });
    }
    for (const [x, y, cell] of data.ties) this.ties.set(pointKey({ x, y }), valid(cell));
    for (const [a, b, first, threshold, last] of data.portals) {
      const points = [first, threshold, last].map(([x, y]) => ({ x, y }));
      for (const [from, to] of [
        [valid(a), valid(b)],
        [valid(b), valid(a)],
      ]) {
        const list = this.portals.get(from) ?? [];
        list.push({ cell: to, opening: from === this.offset + a ? points : [...points].reverse() });
        this.portals.set(from, list);
      }
    }
  }
  stairApproach(node: TopologyNode) {
    const entry = this.stairDoors.get(node.id);
    if (
      (node.kind === 'stair-landing' || node.kind === 'elevator-stop') &&
      node.planId === this.plan.id &&
      node.sourceSha256 === this.plan.sourceSha256 &&
      entry?.version === node.version &&
      entry.point.x === node.point.x &&
      entry.point.y === node.point.y
    )
      return entry;
  }
  approachAt(point: PagePoint, node?: TopologyNode) {
    const door = node && this.stairApproach(node);
    if (door) return door;
    const cell = this.ties.get(pointKey(point)) ?? this.containingCell(point);
    return cell === undefined ? undefined : { cell, via: [] as PagePoint[] };
  }
  point(id: number): PagePoint {
    const cell = id - this.offset;
    return {
      x: (((cell % this.width) + 0.5) * this.step) / this.plan.width,
      y: ((Math.floor(cell / this.width) + 0.5) * this.step) / this.plan.height,
    };
  }
  thresholdId(p: PagePoint) {
    return this.plan.id + ':' + this.version + ':door:' + pointKey(p);
  }
  containingCell(point: PagePoint) {
    const x = Math.floor((point.x * this.plan.width) / this.step),
      y = Math.floor((point.y * this.plan.height) / this.step);
    if (x < 0 || x >= this.width || y < 0) return undefined;
    const cell = y * this.width + x;
    return this.cells[cell] ? this.offset + cell : undefined;
  }
  interiorAt(point: PagePoint) {
    if (!this.interior) return;
    const x = Math.floor((point.x * this.plan.width) / this.step),
      y = Math.floor((point.y * this.plan.height) / this.step);
    if (x < 0 || x >= this.width || y < 0 || y * this.width + x >= this.cells.length) return;
    const path = this.interior.walk(y * this.width + x, (c) => this.point(this.offset + c));
    return path && { ...path, cell: this.offset + path.cell };
  }
  /** Find the free cells across this corridor, stopping at the first wall on each side. */
  crossSection(a: PagePoint, b: PagePoint) {
    const dx = (b.x - a.x) * this.plan.width,
      dy = (b.y - a.y) * this.plan.height,
      span = Math.hypot(dx, dy);
    if (span < this.step * 2) return [];
    for (const t of [0.5, 0.25, 0.75]) {
      const x = a.x + t * (b.x - a.x),
        y = a.y + t * (b.y - a.y);
      const centre = this.containingCell({ x, y });
      if (centre === undefined) continue;
      const cells = new Set([centre]);
      for (const sign of [-1, 1]) {
        for (
          let d = this.step / 2;
          d < Math.max(this.plan.width, this.plan.height);
          d += this.step / 2
        ) {
          const cell = this.containingCell({
            x: x - (((sign * dy) / span) * d) / this.plan.width,
            y: y + (((sign * dx) / span) * d) / this.plan.height,
          });
          if (cell === undefined) break;
          cells.add(cell);
        }
      }
      return [...cells];
    }
    return [];
  }
  stop(cell: number, label: string): MapStop {
    return {
      id: this.plan.id + ':' + this.version + ':cell:' + (cell - this.offset),
      label,
      planId: this.plan.id,
      point: this.point(cell),
    };
  }
  neighbours(id: number, visit: (id: number, cost: number) => void) {
    const cell = id - this.offset,
      x = cell % this.width;
    for (const [dx, dy] of gridDirections) {
      if (x + dx < 0 || x + dx >= this.width) continue;
      const next = cell + dx + dy * this.width;
      if (
        !this.cells[next] ||
        (dx && dy && (!this.cells[cell + dx] || !this.cells[cell + dy * this.width]))
      )
        continue;
      visit(this.offset + next, (this.step * (dx && dy ? Math.SQRT2 : 1)) / 2);
    }
  }
}
const gridDirections = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
function load() {
  const file = resolve(root, 'data/campus/spatial/floor-graphs');
  const bytes = readFileSync(file + '.json');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== readFileSync(file + '.sha256', 'utf8').trim())
    throw Error('Floor graph checksum mismatch.');
  const data = z
    .object({
      schemaVersion: z.literal(1),
      inputSha256: z.record(z.string(), z.string()),
      floors: z.array(floorSchema),
    })
    .parse(JSON.parse(bytes.toString()));
  for (const name of ['spatial/plan-annotations.json', 'spatial/floor-circulation.json']) {
    const actual = createHash('sha256')
      .update(readFileSync(resolve(root, 'data/campus', name)))
      .digest('hex');
    if (actual !== data.inputSha256[name])
      throw Error('Rebuild the floor graph after editing ' + name);
  }
  const floors = new Map(data.floors.map((f) => [f.id, f]));
  if (data.floors.length !== visualPlans.length || floors.size !== visualPlans.length)
    throw Error('The floor graph inventory must match the supplied plans.');
  const ordered = visualPlans.map((plan, i) => {
    const floor = floors.get(plan.id);
    if (!floor) throw Error('Missing floor graph for ' + plan.id);
    return new FloorGraph(plan, floor, i, hash.slice(0, 16));
  });
  return {
    ordered,
    byId: new Map(ordered.map((f) => [f.plan.id, f])),
    places: ordered.flatMap((f) => f.places),
  };
}
let cache: ReturnType<typeof load> | undefined;
export function floorGraphs() {
  return (cache ??= load());
}
const buildings = new Set(visualPlans.map((p) => p.building));
export function sourceBuilding(value: string) {
  const match = /^(NE|NW|SE|SW)[ -]?0*(\d+)$/i.exec(value.normalize('NFKC').trim());
  if (!match) return undefined;
  const name = match[1].toUpperCase() + match[2];
  return buildings.has(name) ? name : undefined;
}
