/**
 * Client-side corridor map-matching for indoor GPS readings.
 * Projects raw browser readings onto verified public walking cells (`WalkingSurface.runs`)
 * using the floor's GIS similarity scale. Raw coordinates stay strictly in browser memory.
 */
import type { VisualPlan } from '../types';
import type { PagePoint, WalkingStep, WalkingSurface } from '../wayfinding';
import { fitCalibration } from './geometry';
import type { DeviceOverlay, DeviceReading, FloorCalibration } from './types';

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
});

export type PreviousMatch = { point: PagePoint; timestamp: number };

export type MapMatchResult =
  | { status: 'unavailable' | 'low-accuracy' | 'outside-page' | 'too-far' }
  | { status: 'raw' | 'matched'; overlay: DeviceOverlay };

function onPage(point: PagePoint) {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function makeOverlay(
  point: PagePoint,
  radiusMetres: number,
  scale: number,
  plan: VisualPlan,
  snapDistanceMetres?: number,
): DeviceOverlay {
  return {
    point,
    radiusX: (radiusMetres * scale) / plan.width,
    radiusY: (radiusMetres * scale) / plan.height,
    ...(snapDistanceMetres !== undefined ? { snapDistanceMetres } : {}),
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
}: {
  reading: DeviceReading;
  plan: VisualPlan;
  calibration?: FloorCalibration;
  surface?: WalkingSurface | null;
  routePath?: PagePoint[];
  stepKind?: WalkingStep['kind'];
  previous?: PreviousMatch | null;
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
      ? { status: 'raw', overlay: makeOverlay(rawPoint, reading.accuracy, scale, plan) }
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
  const maxTravelMetres = hasContinuity
    ? MAP_MATCH_CONFIG.maxWalkingSpeedMps * ((reading.timestamp - previous.timestamp) / 1000)
    : Infinity;

  let bestPointPx: PagePoint | null = null;
  let bestRawMetres = Infinity;
  let bestCost = Infinity;

  const scoreCandidate = (candidatePx: PagePoint, dRawPx: number) => {
    if (dRawPx > limitPx) return;
    const dRawMetres = dRawPx / scale;
    const dPrevMetres = prevPx
      ? Math.hypot(prevPx.x - candidatePx.x, prevPx.y - candidatePx.y) / scale
      : 0;
    const continuityPenalty =
      prevPx && dPrevMetres > maxTravelMetres
        ? MAP_MATCH_CONFIG.continuityWeight * (dPrevMetres - maxTravelMetres)
        : 0;
    const routePenalty = routePx
      ? Math.min(
          MAP_MATCH_CONFIG.routeTieBreakCapMetres,
          MAP_MATCH_CONFIG.routeTieBreakWeight * (distanceToPolylinePx(candidatePx, routePx) / scale),
        )
      : 0;
    const cost = dRawMetres + continuityPenalty + routePenalty;
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

  if (!bestPointPx) return { status: 'too-far' };

  const matchedPoint = {
    x: (bestPointPx as PagePoint).x / plan.width,
    y: (bestPointPx as PagePoint).y / plan.height,
  };
  if (!onPage(matchedPoint)) return { status: 'outside-page' };

  // Keep the uncertainty halo at least as wide as both reported accuracy and snap shift.
  const radiusMetres = Math.max(reading.accuracy, bestRawMetres);
  const snapDistanceMetres =
    bestRawMetres >= MAP_MATCH_CONFIG.snapNoticeThresholdMetres ? bestRawMetres : undefined;
  return {
    status: 'matched',
    overlay: makeOverlay(matchedPoint, radiusMetres, scale, plan, snapDistanceMetres),
  };
}
