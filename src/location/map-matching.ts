/**
 * Client-side corridor map-matching for indoor GPS readings.
 * Projects raw browser readings onto verified public walking cells (`WalkingSurface.runs`)
 * using the floor's GIS similarity scale. Raw coordinates stay strictly in browser memory.
 */
import type { VisualPlan } from '../types';
import type { PagePoint, WalkingStep, WalkingSurface } from '../wayfinding';
import { fitCalibration } from './geometry';
import type {
  DeviceOverlay,
  DeviceReading,
  FloorCalibration,
  MotionActivityState,
  TrackingMode,
} from './types';

export const MAP_MATCH_CONFIG = Object.freeze({
  maxReportedAccuracyMetres: 35,
  maxSnapMetres: 20,
  /** Floor allowance so ~10 m exterior pulls still match even when a phone under-reports error. */
  minSnapFloorMetres: 12,
  /** Shifts smaller than this mean the raw reading already sits on the walkable corridor. */
  snapNoticeThresholdMetres: 0.5,
  maxWalkingSpeedMps: 2.0,
  continuityGapMs: 10_000,
  continuityWeight: 0.5,
  /** Mild preference for the active route step to break ties without hiding off-route detours. */
  routeTieBreakWeight: 0.15,
  routeTieBreakCapMetres: 3.0,
  /** Tier 2 walking continuity budget derived from detected step distance. */
  stepTravelMultiplier: 1.35,
  stepTravelSlackMetres: 1.0,
});

export type PreviousMatch = { point: PagePoint; timestamp: number };

export type MotionGatingInput = {
  /** Only 'stationary' or 'moving' influences matching; 'unknown' degrades identically to Tier 1. */
  activity: MotionActivityState;
  /** Fixed corridor point held while activity === 'stationary' until released. */
  stationaryAnchor?: PagePoint | null;
  /** Estimated step distance walked since `previous.timestamp` (metres). */
  deltaStepDistanceMetres?: number;
  /** True once independent GPS timestamps confirm relocation away from `stationaryAnchor`. */
  stationaryAnchorReleased?: boolean;
};

export type MapMatchResult =
  | { status: 'unavailable' | 'low-accuracy' | 'outside-page' | 'too-far' }
  | { status: 'raw'; overlay: DeviceOverlay }
  | {
      status: 'matched';
      overlay: DeviceOverlay;
      /** Unanchored nearest-corridor GPS match used for independent stationary-hold divergence checks. */
      unanchoredPoint: PagePoint;
      /** Distance between raw projected GPS and `overlay.point` in metres. */
      rawOffsetMetres: number;
    };

function onPage(point: PagePoint) {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function makeOverlay(
  point: PagePoint,
  radiusMetres: number,
  scale: number,
  plan: VisualPlan,
  snapDistanceMetres?: number,
  trackingMode?: TrackingMode,
): DeviceOverlay {
  return {
    point,
    radiusX: (radiusMetres * scale) / plan.width,
    radiusY: (radiusMetres * scale) / plan.height,
    ...(snapDistanceMetres !== undefined ? { snapDistanceMetres } : {}),
    ...(trackingMode !== undefined ? { trackingMode } : {}),
  };
}

function distanceToPolylinePx(pointPx: PagePoint, polylinePx: PagePoint[]) {
  if (polylinePx.length === 1) {
    return Math.hypot(pointPx.x - polylinePx[0].x, pointPx.y - polylinePx[0].y);
  }
  let bestDistSq = Infinity;
  for (let i = 0; i < polylinePx.length - 1; i++) {
    const a = polylinePx[i];
    const b = polylinePx[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq > 0 ? Math.max(0, Math.min(1, ((pointPx.x - a.x) * dx + (pointPx.y - a.y) * dy) / lenSq)) : 0;
    const distSq = (pointPx.x - (a.x + t * dx)) ** 2 + (pointPx.y - (a.y + t * dy)) ** 2;
    if (distSq < bestDistSq) bestDistSq = distSq;
  }
  return Math.sqrt(bestDistSq);
}

function clampToRun(pointPx: PagePoint, y: number, left: number, right: number, step: number): PagePoint {
  return {
    x: Math.max(left * step, Math.min((right + 1) * step, pointPx.x)),
    y: Math.max(y * step, Math.min((y + 1) * step, pointPx.y)),
  };
}

/**
 * Constrain a fresh indoor GPS reading onto the current floor's verified public corridors.
 * Outdoor steps and missing surfaces fall back to `'raw'`; mismatched source hashes return `'unavailable'`.
 */
export function matchDeviceToFloor({
  reading,
  plan,
  calibration,
  surface,
  routePath,
  stepKind,
  previous,
  motion,
}: {
  reading: DeviceReading;
  plan: VisualPlan;
  calibration?: FloorCalibration;
  surface?: WalkingSurface | null;
  routePath?: PagePoint[];
  stepKind?: WalkingStep['kind'];
  previous?: PreviousMatch | null;
  motion?: MotionGatingInput | null;
}): MapMatchResult {
  if (
    !calibration ||
    calibration.status !== 'approximate' ||
    calibration.planId !== plan.id ||
    calibration.sourceSha256 !== plan.sourceSha256
  )
    return { status: 'unavailable' };

  const { project, scale } = fitCalibration(calibration.controls, plan.width, plan.height);
  const rawPoint = project(reading);

  if (stepKind !== 'outdoor' && reading.accuracy > MAP_MATCH_CONFIG.maxReportedAccuracyMetres) {
    return { status: 'low-accuracy' };
  }

  // Outdoor steps have unmapped exterior geometry; missing surfaces fall back to raw footprint gating.
  if (stepKind === 'outdoor' || !surface) {
    return onPage(rawPoint)
      ? {
          status: 'raw',
          overlay: makeOverlay(rawPoint, reading.accuracy, scale, plan, undefined, 'raw'),
        }
      : { status: 'outside-page' };
  }

  if (
    surface.planId !== plan.id ||
    surface.sourceSha256 !== plan.sourceSha256 ||
    !Number.isFinite(surface.step) ||
    surface.step <= 0 ||
    !surface.runs.length
  )
    return { status: 'unavailable' };

  const rawPx = { x: rawPoint.x * plan.width, y: rawPoint.y * plan.height };
  const limitPx =
    Math.min(
      MAP_MATCH_CONFIG.maxSnapMetres,
      Math.max(reading.accuracy, MAP_MATCH_CONFIG.minSnapFloorMetres),
    ) * scale;
  const routePx = routePath?.length
    ? routePath.map((p) => ({ x: p.x * plan.width, y: p.y * plan.height }))
    : null;

  const hasContinuity =
    !!previous &&
    Number.isFinite(previous.point.x) &&
    Number.isFinite(previous.point.y) &&
    reading.timestamp >= previous.timestamp &&
    reading.timestamp - previous.timestamp <= MAP_MATCH_CONFIG.continuityGapMs;
  const prevPx = hasContinuity
    ? { x: previous.point.x * plan.width, y: previous.point.y * plan.height }
    : null;

  const motionMoving = motion?.activity === 'moving';
  const maxTravelMetres = hasContinuity
    ? motionMoving && Number.isFinite(motion.deltaStepDistanceMetres)
      ? Math.max(
          1.0,
          (motion.deltaStepDistanceMetres ?? 0) * MAP_MATCH_CONFIG.stepTravelMultiplier +
            MAP_MATCH_CONFIG.stepTravelSlackMetres,
        )
      : MAP_MATCH_CONFIG.maxWalkingSpeedMps * ((reading.timestamp - previous.timestamp) / 1000)
    : Infinity;

  let bestPointPx: PagePoint | null = null;
  let bestRawMetres = Infinity;
  let bestCost = Infinity;

  let unanchoredPointPx: PagePoint | null = null;
  let unanchoredRawMetres = Infinity;
  let unanchoredCost = Infinity;

  const scoreCandidate = (candidatePx: PagePoint, dRawPx: number) => {
    if (dRawPx > limitPx) return;
    const dRawMetres = dRawPx / scale;
    const routePenalty = routePx
      ? Math.min(
          MAP_MATCH_CONFIG.routeTieBreakCapMetres,
          MAP_MATCH_CONFIG.routeTieBreakWeight * (distanceToPolylinePx(candidatePx, routePx) / scale),
        )
      : 0;

    const baseCost = dRawMetres + routePenalty;
    if (
      baseCost < unanchoredCost - 1e-9 ||
      (Math.abs(baseCost - unanchoredCost) <= 1e-9 && dRawMetres < unanchoredRawMetres)
    ) {
      unanchoredCost = baseCost;
      unanchoredRawMetres = dRawMetres;
      unanchoredPointPx = candidatePx;
    }

    const dPrevMetres = prevPx
      ? Math.hypot(prevPx.x - candidatePx.x, prevPx.y - candidatePx.y) / scale
      : 0;
    const continuityPenalty =
      prevPx && dPrevMetres > maxTravelMetres
        ? MAP_MATCH_CONFIG.continuityWeight * (dPrevMetres - maxTravelMetres)
        : 0;
    const cost = baseCost + continuityPenalty;
    if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && dRawMetres < bestRawMetres)) {
      bestCost = cost;
      bestRawMetres = dRawMetres;
      bestPointPx = candidatePx;
    }
  };

  for (const [y, left, right] of surface.runs) {
    const nearestOnRun = clampToRun(rawPx, y, left, right, surface.step);
    const dRawPx = Math.hypot(rawPx.x - nearestOnRun.x, rawPx.y - nearestOnRun.y);
    if (dRawPx > limitPx) continue;
    scoreCandidate(nearestOnRun, dRawPx);
    if (prevPx) {
      const anchorOnRun = clampToRun(prevPx, y, left, right, surface.step);
      scoreCandidate(anchorOnRun, Math.hypot(rawPx.x - anchorOnRun.x, rawPx.y - anchorOnRun.y));
    }
  }

  if (!bestPointPx || !unanchoredPointPx) return { status: 'too-far' };

  const unanchoredPoint = {
    x: (unanchoredPointPx as PagePoint).x / plan.width,
    y: (unanchoredPointPx as PagePoint).y / plan.height,
  };

  // Tier 2 hard stationary hold: retain exact corridor anchor (0 m drift) until a step,
  // sensor silence, or independently confirmed multi-fix relocation releases it.
  if (
    motion?.activity === 'stationary' &&
    motion.stationaryAnchor &&
    !motion.stationaryAnchorReleased &&
    onPage(motion.stationaryAnchor)
  ) {
    const anchorPx = {
      x: motion.stationaryAnchor.x * plan.width,
      y: motion.stationaryAnchor.y * plan.height,
    };
    const anchorOffsetMetres = Math.hypot(rawPx.x - anchorPx.x, rawPx.y - anchorPx.y) / scale;
    const radiusMetres = Math.max(reading.accuracy, anchorOffsetMetres);
    const snapDistanceMetres =
      anchorOffsetMetres >= MAP_MATCH_CONFIG.snapNoticeThresholdMetres
        ? anchorOffsetMetres
        : undefined;
    return {
      status: 'matched',
      overlay: makeOverlay(
        motion.stationaryAnchor,
        radiusMetres,
        scale,
        plan,
        snapDistanceMetres,
        'motion-gated',
      ),
      unanchoredPoint,
      rawOffsetMetres: anchorOffsetMetres,
    };
  }

  const matchedPoint = {
    x: (bestPointPx as PagePoint).x / plan.width,
    y: (bestPointPx as PagePoint).y / plan.height,
  };
  if (!onPage(matchedPoint)) return { status: 'outside-page' };

  // Keep the uncertainty halo at least as wide as both reported accuracy and snap shift.
  const radiusMetres = Math.max(reading.accuracy, bestRawMetres);
  const snapDistanceMetres =
    bestRawMetres >= MAP_MATCH_CONFIG.snapNoticeThresholdMetres ? bestRawMetres : undefined;
  const trackingMode: TrackingMode = motionMoving && hasContinuity ? 'motion-gated' : 'matched';
  return {
    status: 'matched',
    overlay: makeOverlay(matchedPoint, radiusMetres, scale, plan, snapDistanceMetres, trackingMode),
    unanchoredPoint,
    rawOffsetMetres: bestRawMetres,
  };
}
