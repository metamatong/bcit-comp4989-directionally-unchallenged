/** Similarity fitting in page pixels, with normalization only after projection. */
import type { VisualPlan } from '../types';
import type {
  CalibrationControl,
  DeviceOverlay,
  DeviceReading,
  FloorCalibration,
  GeoPoint,
} from './types';

const radians = Math.PI / 180;
export function localMetres(point: GeoPoint, origin: GeoPoint) {
  return {
    x:
      6371008.8 *
      (point.longitude - origin.longitude) *
      radians *
      Math.cos(origin.latitude * radians),
    y: 6371008.8 * (point.latitude - origin.latitude) * radians,
  };
}

export function fitCalibration(controls: CalibrationControl[], width: number, height: number) {
  if (
    controls.length < 4 ||
    !controls.every(
      (c) =>
        [c.latitude, c.longitude, c.x, c.y].every(Number.isFinite) &&
        Math.abs(c.latitude) <= 90 &&
        Math.abs(c.longitude) <= 180 &&
        c.x >= 0 &&
        c.x <= 1 &&
        c.y >= 0 &&
        c.y <= 1,
    )
  )
    throw Error('Invalid calibration controls.');
  const origin = controls[0];
  // The final control remains independent of the fit.
  const fit = controls.slice(0, -1);
  const local = fit.map((c) => localMetres(c, origin));
  const cross =
    (local[1].x - local[0].x) * (local[2].y - local[0].y) -
    (local[1].y - local[0].y) * (local[2].x - local[0].x);
  if (Math.abs(cross) < 1) throw Error('Calibration controls are collinear.');
  const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
  const east = mean(local.map((p) => p.x)),
    north = mean(local.map((p) => p.y));
  const imageX = mean(fit.map((c) => c.x * width)),
    imageY = mean(fit.map((c) => c.y * height));
  let denominator = 0,
    rotation = 0,
    crossRotation = 0;
  local.forEach((p, i) => {
    const x = p.x - east,
      y = p.y - north;
    const dx = fit[i].x * width - imageX,
      dy = fit[i].y * height - imageY;
    denominator += x * x + y * y;
    rotation += x * dx - y * dy;
    crossRotation += y * dx + x * dy;
  });
  const a = rotation / denominator,
    b = crossRotation / denominator;
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale) || scale <= 0) throw Error('Degenerate calibration.');
  const project = (coordinate: GeoPoint) => {
    const point = localMetres(coordinate, origin);
    return {
      x: (a * (point.x - east) + b * (point.y - north) + imageX) / width,
      y: (b * (point.x - east) - a * (point.y - north) + imageY) / height,
    };
  };
  const unproject = (point: { x: number; y: number }): GeoPoint => {
    const dx = point.x * width - imageX;
    const dy = point.y * height - imageY;
    const localEast = east + (a * dx + b * dy) / scale ** 2;
    const localNorth = north + (b * dx - a * dy) / scale ** 2;
    return {
      latitude: origin.latitude + localNorth / (6371008.8 * radians),
      longitude:
        origin.longitude + localEast / (6371008.8 * radians * Math.cos(origin.latitude * radians)),
    };
  };
  const residuals = controls.map((c) => {
    const p = project(c);
    return Math.hypot((p.x - c.x) * width, (p.y - c.y) * height) / scale;
  });
  /** Convert a True North clockwise bearing (radians: 0 = North, +pi/2 = East) to floor-plan pixel angle. */
  const bearingToPlanAngle = (trueBearingRad: number) => {
    const dx = a * Math.sin(trueBearingRad) + b * Math.cos(trueBearingRad);
    const dy = b * Math.sin(trueBearingRad) - a * Math.cos(trueBearingRad);
    return Math.atan2(dy, dx);
  };
  return { project, unproject, scale, residuals, bearingToPlanAngle };
}

export function deviceOverlay(
  reading: DeviceReading,
  plan: VisualPlan,
  calibration?: FloorCalibration,
): DeviceOverlay | null {
  if (
    !calibration ||
    calibration.status !== 'approximate' ||
    calibration.planId !== plan.id ||
    calibration.sourceSha256 !== plan.sourceSha256
  )
    return null;
  const fit = fitCalibration(calibration.controls, plan.width, plan.height);
  return {
    point: fit.project(reading),
    radiusX: (reading.accuracy * fit.scale) / plan.width,
    radiusY: (reading.accuracy * fit.scale) / plan.height,
    uncertaintyRadiusMetres: reading.accuracy,
  };
}

export function overlapsBounds(
  overlay: Pick<DeviceOverlay, 'point' | 'radiusX' | 'radiusY'>,
  bounds: [number, number, number, number],
) {
  const dx = Math.max(bounds[0] - overlay.point.x, 0, overlay.point.x - bounds[2]);
  const dy = Math.max(bounds[1] - overlay.point.y, 0, overlay.point.y - bounds[3]);
  if (!overlay.radiusX || !overlay.radiusY) return dx === 0 && dy === 0;
  return (dx / overlay.radiusX) ** 2 + (dy / overlay.radiusY) ** 2 <= 1;
}

/** Even/odd polygon membership plus distance to every boundary handles holes and multipart footprints. */
export function overlapsFootprint(reading: DeviceReading, rings: number[][][]) {
  let inside = false;
  for (const ring of rings) {
    const points = ring.map(([longitude, latitude]) =>
      localMetres({ longitude, latitude }, reading),
    );
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j],
        b = points[i];
      if (a.y > 0 !== b.y > 0 && 0 < ((b.x - a.x) * -a.y) / (b.y - a.y) + a.x) inside = !inside;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const fraction = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + fraction * dx, a.y + fraction * dy) <= reading.accuracy) return true;
    }
  }
  return inside;
}
