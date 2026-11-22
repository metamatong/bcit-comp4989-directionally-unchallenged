/**
 * Packed bitmask spatial index over verified public WalkingSurface.runs cells.
 * Enforces the exact same adjacent-cell and orthogonal-guarded diagonal connectivity as
 * server/floor-graph.ts (`FloorGraph.neighbours`), preventing wall-jumping or corner-cutting.
 */
import type { PagePoint, WalkingSurface } from '../wayfinding';

const DEG_TO_RAD = Math.PI / 180;
const SLIDE_DEFLECTIONS_RAD = [
  12 * DEG_TO_RAD,
  -12 * DEG_TO_RAD,
  24 * DEG_TO_RAD,
  -24 * DEG_TO_RAD,
];
const PROBE_COUNT = 16;

export type StepTraceOutcome = 'clear' | 'slide' | 'blocked';

export type StepTraceResult = {
  pointPx: PagePoint;
  headingPx: number;
  outcome: StepTraceOutcome;
};

export type SegmentTraceResult = {
  reached: boolean;
  lastWalkablePx: PagePoint;
};

const gridCache = new WeakMap<WalkingSurface, WalkableGrid>();

/** Return a cached WalkableGrid for the given source-bound WalkingSurface. */
export function getWalkableGrid(
  surface: WalkingSurface,
  planWidth: number,
  planHeight: number,
): WalkableGrid {
  const cached = gridCache.get(surface);
  if (cached && cached.planWidth === planWidth && cached.planHeight === planHeight) {
    return cached;
  }
  const built = new WalkableGrid(surface, planWidth, planHeight);
  gridCache.set(surface, built);
  return built;
}

export class WalkableGrid {
  readonly cols: number;
  readonly rows: number;
  readonly step: number;
  readonly planWidth: number;
  readonly planHeight: number;
  private readonly bits: Uint8Array;
  private readonly runs: [number, number, number][];

  constructor(surface: WalkingSurface, planWidth: number, planHeight: number) {
    this.step = surface.step;
    this.planWidth = planWidth;
    this.planHeight = planHeight;
    this.cols = Math.max(1, Math.ceil(planWidth / surface.step));
    this.rows = Math.max(1, Math.ceil(planHeight / surface.step));
    this.runs = surface.runs;
    this.bits = new Uint8Array(Math.ceil((this.cols * this.rows) / 8));

    for (const [y, left, right] of surface.runs) {
      if (y < 0 || y >= this.rows) continue;
      const startX = Math.max(0, left);
      const endX = Math.min(this.cols - 1, right);
      const rowOffset = y * this.cols;
      for (let x = startX; x <= endX; x++) {
        const idx = rowOffset + x;
        this.bits[idx >> 3] |= 1 << (idx & 7);
      }
    }
  }

  isWalkableCell(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return false;
    const idx = gy * this.cols + gx;
    return (this.bits[idx >> 3] & (1 << (idx & 7))) !== 0;
  }

  isWalkablePx(xPx: number, yPx: number): boolean {
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) return false;
    return this.isWalkableCell(Math.floor(xPx / this.step), Math.floor(yPx / this.step));
  }

  /**
   * Matches server/floor-graph.ts `FloorGraph.neighbours`:
   * adjacent public cells only, and diagonal moves require both orthogonal side cells to be free.
   */
  canStepBetweenAdjacentCells(gx0: number, gy0: number, gx1: number, gy1: number): boolean {
    const dx = gx1 - gx0;
    const dy = gy1 - gy0;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    if (!this.isWalkableCell(gx1, gy1)) return false;
    if (dx !== 0 && dy !== 0) {
      return this.isWalkableCell(gx1, gy0) && this.isWalkableCell(gx0, gy1);
    }
    return true;
  }

  private cellCenterPx(gx: number, gy: number): PagePoint {
    return {
      x: (gx + 0.5) * this.step,
      y: (gy + 0.5) * this.step,
    };
  }

  /**
   * Strictly connected 2D grid DDA traversal from `fromPx` to `toPx`.
   * Zero blanket gap allowance: every cell crossed must be walkable and corner crossings
   * must satisfy orthogonal-guarded connectivity.
   */
  traceConnectedSegment(fromPx: PagePoint, toPx: PagePoint): SegmentTraceResult {
    const fromCellX = fromPx.x / this.step;
    const fromCellY = fromPx.y / this.step;
    const toCellX = toPx.x / this.step;
    const toCellY = toPx.y / this.step;

    let gx = Math.floor(fromCellX);
    let gy = Math.floor(fromCellY);
    const endGx = Math.floor(toCellX);
    const endGy = Math.floor(toCellY);

    if (!this.isWalkableCell(gx, gy)) {
      return { reached: false, lastWalkablePx: fromPx };
    }
    if (gx === endGx && gy === endGy) {
      return { reached: true, lastWalkablePx: toPx };
    }

    const dx = toCellX - fromCellX;
    const dy = toCellY - fromCellY;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX =
      stepX > 0
        ? (gx + 1 - fromCellX) * tDeltaX
        : stepX < 0
          ? (fromCellX - gx) * tDeltaX
          : Infinity;
    let tMaxY =
      stepY > 0
        ? (gy + 1 - fromCellY) * tDeltaY
        : stepY < 0
          ? (fromCellY - gy) * tDeltaY
          : Infinity;

    const maxSteps = Math.abs(endGx - gx) + Math.abs(endGy - gy) + 2;
    for (let iter = 0; iter < maxSteps && (gx !== endGx || gy !== endGy); iter++) {
      let nextGx = gx;
      let nextGy = gy;
      if (Math.abs(tMaxX - tMaxY) <= 1e-9) {
        nextGx += stepX;
        nextGy += stepY;
        tMaxX += tDeltaX;
        tMaxY += tDeltaY;
      } else if (tMaxX < tMaxY) {
        nextGx += stepX;
        tMaxX += tDeltaX;
      } else {
        nextGy += stepY;
        tMaxY += tDeltaY;
      }

      if (!this.canStepBetweenAdjacentCells(gx, gy, nextGx, nextGy)) {
        return { reached: false, lastWalkablePx: this.cellCenterPx(gx, gy) };
      }
      gx = nextGx;
      gy = nextGy;
    }

    if (gx === endGx && gy === endGy) {
      return { reached: true, lastWalkablePx: toPx };
    }
    return { reached: false, lastWalkablePx: this.cellCenterPx(gx, gy) };
  }

  /**
   * Advance a particle by `stepDistPx` along `headingPx` using strictly connected cells.
   * On a grazing wall hit, attempts narrow deflected rays from `fromPx` using the same strict
   * connected traversal so wall-sliding can glide down a corridor without crossing thin walls.
   */
  traceStep(fromPx: PagePoint, headingPx: number, stepDistPx: number): StepTraceResult {
    const targetPx = {
      x: fromPx.x + stepDistPx * Math.cos(headingPx),
      y: fromPx.y + stepDistPx * Math.sin(headingPx),
    };
    const direct = this.traceConnectedSegment(fromPx, targetPx);
    if (direct.reached) {
      return { pointPx: targetPx, headingPx, outcome: 'clear' };
    }

    for (const delta of SLIDE_DEFLECTIONS_RAD) {
      const candidateHeading = headingPx + delta;
      const candidatePx = {
        x: fromPx.x + stepDistPx * Math.cos(candidateHeading),
        y: fromPx.y + stepDistPx * Math.sin(candidateHeading),
      };
      const slide = this.traceConnectedSegment(fromPx, candidatePx);
      if (slide.reached) {
        return {
          pointPx: candidatePx,
          headingPx: headingPx + delta * 0.35,
          outcome: 'slide',
        };
      }
    }

    return { pointPx: direct.lastWalkablePx, headingPx, outcome: 'blocked' };
  }

  /** Apply resampling jitter only if the displaced point stays strictly grid-connected. */
  jitterConnected(fromPx: PagePoint, dxPx: number, dyPx: number): PagePoint {
    const candidate = { x: fromPx.x + dxPx, y: fromPx.y + dyPx };
    return this.traceConnectedSegment(fromPx, candidate).reached ? candidate : fromPx;
  }

  /** Find strictly connected open corridor axes around `pointPx` for multi-modal heading init. */
  probeOpenHeadings(pointPx: PagePoint, probeDistPx: number): number[] {
    if (!this.isWalkablePx(pointPx.x, pointPx.y)) return [];
    const open: number[] = [];
    for (let i = 0; i < PROBE_COUNT; i++) {
      const angle = (i * 2 * Math.PI) / PROBE_COUNT;
      const target = {
        x: pointPx.x + probeDistPx * Math.cos(angle),
        y: pointPx.y + probeDistPx * Math.sin(angle),
      };
      if (this.traceConnectedSegment(pointPx, target).reached) {
        open.push(angle);
      }
    }
    return open;
  }

  /**
   * Snap `pointPx` to the nearest walkable cell within `maxDistPx`, clamping strictly inside
   * the winning cell bounds so `isWalkablePx()` always returns true for the returned point.
   */
  nearestWalkablePx(
    pointPx: PagePoint,
    maxDistPx: number,
  ): { pointPx: PagePoint; distPx: number } | null {
    if (this.isWalkablePx(pointPx.x, pointPx.y)) {
      return { pointPx, distPx: 0 };
    }
    const eps = Math.min(1e-3, this.step * 0.01);
    let bestDistSq = maxDistPx * maxDistPx;
    let bestPoint: PagePoint | null = null;

    for (const [y, left, right] of this.runs) {
      const minX = left * this.step + eps;
      const maxX = (right + 1) * this.step - eps;
      const minY = y * this.step + eps;
      const maxY = (y + 1) * this.step - eps;
      const cx = Math.max(minX, Math.min(maxX, pointPx.x));
      const cy = Math.max(minY, Math.min(maxY, pointPx.y));
      const dSq = (pointPx.x - cx) ** 2 + (pointPx.y - cy) ** 2;
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        bestPoint = { x: cx, y: cy };
      }
    }

    return bestPoint ? { pointPx: bestPoint, distPx: Math.sqrt(bestDistSq) } : null;
  }
}
