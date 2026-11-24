/**
 * Pure, DOM-free heading estimator for the live directional cone.
 * Combines tilt-compensated browser compass headings (iOS webkitCompassHeading or
 * Android/W3C deviceorientationabsolute) with gravity-projected gyroscope yaw via a
 * circular complementary filter that damps brief indoor magnetic spikes, with a
 * Stage 2 PDR travel-heading fallback when compass data is unavailable.
 *
 * All sensor readings remain strictly transient in browser memory.
 */
import type { DeviceHeading, RawOrientationSample } from './types';

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

export const HEADING_CONFIG = Object.freeze({
  /** WMM2025 magnetic declination for BCIT Burnaby (49.25 N, 123.00 W), degrees East positive. */
  bcitDeclinationDeg: 15.3,
  /** Reject browser compass readings with accuracy worse than this threshold. */
  maxCompassAccuracyDeg: 45,
  /** Normal complementary filter time constant toward compass when live gyro is active. */
  compassTauSec: 1.5,
  /** Innovation threshold above which a sudden compass jump is treated as a magnetic spike. */
  magneticSpikeThresholdRad: (45 * Math.PI) / 180,
  /** Slower time constant while damping a suspected transient indoor magnetic spike. */
  spikeTauSec: 5.0,
  /** Duration a large innovation must persist consistently before resuming normal convergence. */
  spikeConfirmMs: 2_500,
  /** Circular exponential smoothing time constant when no gyroscope is available. */
  compassOnlyTauSec: 0.25,
  /** Maximum gap between consecutive gyro yaw frames integrated by the filter. */
  maxGyroDtSec: 0.5,
  /** Compass expiry window when orientation events stop arriving. */
  compassStaleMs: 3_000,
  /** Gyro freshness window for complementary fusion and stationary PDR fallback rotation. */
  gyroStaleMs: 1_500,
  /** Bounded duration to keep rotating a resolved Stage 2 PDR heading via gyro when stationary. */
  pdrStationaryHoldMs: 45_000,
});

export type PdrHeadingFallback = {
  /** Resolved floor-plan pixel angle from Stage 2 particle cloud (radians). */
  angleRad: number;
  /** Circular heading resultant length R in [0, 1]. */
  resultant: number;
};

export function wrapAngleRad(rad: number): number {
  let a = rad % TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  return a;
}

export function normalizePositiveRad(rad: number): number {
  const a = rad % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function spreadForCompassAccuracy(accuracyDeg?: number): number {
  if (accuracyDeg === undefined) return 65;
  if (accuracyDeg <= 20) return 50;
  if (accuracyDeg <= 35) return 65;
  return 85;
}

function spreadForPdrResultant(resultant: number): number {
  if (resultant >= 0.85) return 50;
  if (resultant >= 0.72) return 65;
  return 85;
}

/**
 * Extract screen-oriented magnetic bearing (clockwise radians from Magnetic North)
 * from a raw DeviceOrientationEvent sample. Returns null when uncalibrated, non-absolute,
 * or held in a singular orientation (e.g., straight overhead/upside-down).
 */
export function extractMagneticBearingRad(
  sample: RawOrientationSample,
): { bearingRad: number; accuracyDeg?: number } | null {
  const screenAngleDeg = Number.isFinite(sample.screenAngleDeg) ? sample.screenAngleDeg : 0;

  // 1. iOS Safari provides tilt-compensated magnetic heading directly via webkitCompassHeading.
  if (
    typeof sample.webkitCompassHeading === 'number' &&
    Number.isFinite(sample.webkitCompassHeading)
  ) {
    const rawAcc = sample.webkitCompassAccuracy;
    let accuracyDeg: number | undefined;
    if (typeof rawAcc === 'number' && Number.isFinite(rawAcc)) {
      if (rawAcc < 0 || rawAcc > HEADING_CONFIG.maxCompassAccuracyDeg) {
        return null;
      }
      accuracyDeg = rawAcc;
    }
    const bearingDeg = sample.webkitCompassHeading + screenAngleDeg;
    return {
      bearingRad: normalizePositiveRad(bearingDeg * DEG_TO_RAD),
      ...(accuracyDeg !== undefined ? { accuracyDeg } : {}),
    };
  }

  // 2. W3C / Android Chrome absolute orientation: compute full 3D rotation matrix R = Rz(a)Rx(b)Ry(g)
  // to avoid gimbal lock when tilting between flat face-up and upright portrait holds.
  if (
    !sample.absolute ||
    typeof sample.alpha !== 'number' ||
    typeof sample.beta !== 'number' ||
    typeof sample.gamma !== 'number' ||
    !Number.isFinite(sample.alpha) ||
    !Number.isFinite(sample.beta) ||
    !Number.isFinite(sample.gamma)
  ) {
    return null;
  }

  const a = sample.alpha * DEG_TO_RAD;
  const b = sample.beta * DEG_TO_RAD;
  const g = sample.gamma * DEG_TO_RAD;
  const ca = Math.cos(a),
    sa = Math.sin(a);
  const cb = Math.cos(b),
    sb = Math.sin(b);
  const cg = Math.cos(g),
    sg = Math.sin(g);

  // Columns of R = Rz(a) * Rx(b) * Ry(g) mapping device (X right, Y top, Z screen-out) -> world (East, North, Up).
  const ex = ca * cg - sa * sb * sg;
  const nx = sa * cg + ca * sb * sg;
  const ux = -cb * sg;

  const ey = -sa * cb;
  const ny = ca * cb;
  const uy = sb;

  const ez = ca * sg + sa * sb * cg;
  const nz = sa * sg - ca * sb * cg;

  // Screen-top unit vector in device coordinates accounts for portrait/landscape rotation.
  const screenRad = screenAngleDeg * DEG_TO_RAD;
  const sinS = Math.sin(screenRad);
  const cosS = Math.cos(screenRad);
  const upE = sinS * ex + cosS * ey;
  const upN = sinS * nx + cosS * ny;
  const upU = sinS * ux + cosS * uy;
  const upNorm = Math.hypot(upE, upN);

  // Back-of-phone unit vector (-Z_dev) represents facing direction when held upright.
  const backE = -ez;
  const backN = -nz;
  const backNorm = Math.hypot(backE, backN);

  const minNorm = 0.15;
  const hasUp = upNorm >= minNorm;
  const hasBack = backNorm >= minNorm;
  if (!hasUp && !hasBack) return null;

  let east = 0;
  let north = 0;
  if (hasUp && hasBack) {
    const upUe = upE / upNorm;
    const upUn = upN / upNorm;
    const backUe = backE / backNorm;
    const backUn = backN / backNorm;
    const dot = upUe * backUe + upUn * backUn;
    if (dot > 0) {
      // Smooth handoff from flat face-up (upU ~ 0) to upright portrait (upU ~ 1) across 30-58 deg tilt.
      const backWeight = clamp((upU - 0.5) / 0.35, 0, 1);
      east = (1 - backWeight) * upUe + backWeight * backUe;
      north = (1 - backWeight) * upUn + backWeight * backUn;
    } else if (backNorm > upNorm) {
      east = backUe;
      north = backUn;
    } else {
      east = upUe;
      north = upUn;
    }
  } else if (hasBack) {
    east = backE;
    north = backN;
  } else {
    east = upE;
    north = upN;
  }

  if (Math.hypot(east, north) < 1e-6) return null;
  return { bearingRad: normalizePositiveRad(Math.atan2(east, north)) };
}

/**
 * Stateful hybrid heading filter fusing absolute compass samples, live world gyro yaw rate,
 * and optional Stage 2 PDR travel-direction fallback.
 */
export class HeadingEstimator {
  private fusedBearingRad: number | null = null;
  private lastCompassAt: number | null = null;
  private lastCompassAccuracyDeg: number | undefined = undefined;
  private lastGyroAt: number | null = null;
  private usingGyro = false;
  private spikeSince: number | null = null;
  private spikeSign = 0;

  private stationaryPdrAngleRad: number | null = null;
  private stationaryPdrAt: number | null = null;

  reset() {
    this.fusedBearingRad = null;
    this.lastCompassAt = null;
    this.lastCompassAccuracyDeg = undefined;
    this.lastGyroAt = null;
    this.usingGyro = false;
    this.spikeSince = null;
    this.spikeSign = 0;
    this.stationaryPdrAngleRad = null;
    this.stationaryPdrAt = null;
  }

  /** Integrate bias-corrected, tilt-invariant world CCW yaw rate (rad/s) from StepMotionEstimator. */
  ingestGyroYaw(omegaCcwRadPerSec: number, timestamp: number): boolean {
    if (!Number.isFinite(omegaCcwRadPerSec) || !Number.isFinite(timestamp)) return false;
    const prevAt = this.lastGyroAt;
    this.lastGyroAt = timestamp;
    if (prevAt === null || timestamp <= prevAt) return false;
    const dtSec = (timestamp - prevAt) / 1000;
    if (dtSec <= 0 || dtSec > HEADING_CONFIG.maxGyroDtSec) return false;

    const deltaCwRad = -omegaCcwRadPerSec * dtSec;
    let updated = false;
    if (this.fusedBearingRad !== null) {
      this.fusedBearingRad = normalizePositiveRad(this.fusedBearingRad + deltaCwRad);
      this.usingGyro = true;
      updated = true;
    }
    if (this.stationaryPdrAngleRad !== null) {
      this.stationaryPdrAngleRad = wrapAngleRad(this.stationaryPdrAngleRad + deltaCwRad);
      updated = true;
    }
    return updated;
  }

  /** Ingest a raw DeviceOrientationEvent sample and update the complementary compass estimate. */
  ingestOrientation(sample: RawOrientationSample): boolean {
    if (!Number.isFinite(sample.timestamp)) return false;
    const extracted = extractMagneticBearingRad(sample);
    if (!extracted) {
      const rawAcc = sample.webkitCompassAccuracy;
      if (
        typeof rawAcc === 'number' &&
        Number.isFinite(rawAcc) &&
        (rawAcc < 0 || rawAcc > HEADING_CONFIG.maxCompassAccuracyDeg)
      ) {
        this.fusedBearingRad = null;
        this.lastCompassAt = null;
        this.lastCompassAccuracyDeg = undefined;
        this.usingGyro = false;
        this.spikeSince = null;
        return true;
      }
      return false;
    }

    const trueBearingRad = normalizePositiveRad(
      extracted.bearingRad + HEADING_CONFIG.bcitDeclinationDeg * DEG_TO_RAD,
    );
    const prevCompassAt = this.lastCompassAt;
    const dtSec =
      prevCompassAt !== null && sample.timestamp > prevCompassAt
        ? Math.min(1.0, (sample.timestamp - prevCompassAt) / 1000)
        : 0;
    const gyroFresh =
      this.lastGyroAt !== null &&
      sample.timestamp - this.lastGyroAt >= 0 &&
      sample.timestamp - this.lastGyroAt <= HEADING_CONFIG.gyroStaleMs;

    if (this.fusedBearingRad === null) {
      this.fusedBearingRad = trueBearingRad;
      this.spikeSince = null;
      this.spikeSign = 0;
    } else {
      const innovation = wrapAngleRad(trueBearingRad - this.fusedBearingRad);
      let tau: number = gyroFresh
        ? HEADING_CONFIG.compassTauSec
        : HEADING_CONFIG.compassOnlyTauSec;

      if (gyroFresh && Math.abs(innovation) > HEADING_CONFIG.magneticSpikeThresholdRad) {
        const sign = innovation >= 0 ? 1 : -1;
        if (this.spikeSince === null || this.spikeSign !== sign) {
          this.spikeSince = sample.timestamp;
          this.spikeSign = sign;
        }
        if (sample.timestamp - this.spikeSince < HEADING_CONFIG.spikeConfirmMs) {
          tau = HEADING_CONFIG.spikeTauSec;
        }
      } else {
        this.spikeSince = null;
        this.spikeSign = 0;
      }

      const alpha = dtSec > 0 ? 1 - Math.exp(-dtSec / tau) : gyroFresh ? 0.08 : 0.35;
      this.fusedBearingRad = normalizePositiveRad(this.fusedBearingRad + alpha * innovation);
    }

    this.lastCompassAt = sample.timestamp;
    this.lastCompassAccuracyDeg = extracted.accuracyDeg;
    this.usingGyro = gyroFresh;
    return true;
  }

  /** Expire stale sensor streams so a frozen heading cone is never left on screen. */
  checkFreshness(now: number): boolean {
    let changed = false;
    if (this.lastGyroAt !== null && now - this.lastGyroAt > HEADING_CONFIG.gyroStaleMs) {
      this.lastGyroAt = null;
      if (this.usingGyro) {
        this.usingGyro = false;
        changed = true;
      }
    }
    if (this.lastCompassAt !== null && now - this.lastCompassAt > HEADING_CONFIG.compassStaleMs) {
      this.lastCompassAt = null;
      this.lastCompassAccuracyDeg = undefined;
      this.spikeSince = null;
      this.spikeSign = 0;
      if (this.fusedBearingRad !== null) {
        this.fusedBearingRad = null;
        this.usingGyro = false;
        changed = true;
      }
    }
    if (
      this.stationaryPdrAt !== null &&
      now - this.stationaryPdrAt > HEADING_CONFIG.pdrStationaryHoldMs
    ) {
      this.stationaryPdrAngleRad = null;
      this.stationaryPdrAt = null;
      changed = true;
    }
    return changed;
  }

  /** Resolve the current facing estimate in floor-plan pixel coordinates, or null if unavailable. */
  resolvePlanHeading(
    bearingToPlanAngle: (trueBearingRad: number) => number,
    pdrFallback?: PdrHeadingFallback | null,
    now = Date.now(),
  ): DeviceHeading | null {
    this.checkFreshness(now);

    if (this.fusedBearingRad !== null && this.lastCompassAt !== null) {
      this.stationaryPdrAngleRad = null;
      this.stationaryPdrAt = null;
      return {
        angleRad: bearingToPlanAngle(this.fusedBearingRad),
        spreadDeg: spreadForCompassAccuracy(this.lastCompassAccuracyDeg),
        source: this.usingGyro ? 'compass-gyro' : 'compass',
        ...(this.lastCompassAccuracyDeg !== undefined
          ? { accuracyDeg: this.lastCompassAccuracyDeg }
          : {}),
      };
    }

    if (
      pdrFallback &&
      Number.isFinite(pdrFallback.angleRad) &&
      Number.isFinite(pdrFallback.resultant) &&
      pdrFallback.resultant >= 0.55
    ) {
      this.stationaryPdrAngleRad = pdrFallback.angleRad;
      this.stationaryPdrAt = now;
      return {
        angleRad: pdrFallback.angleRad,
        spreadDeg: spreadForPdrResultant(pdrFallback.resultant),
        source: 'pdr',
      };
    }

    if (
      this.stationaryPdrAngleRad !== null &&
      this.lastGyroAt !== null &&
      now - this.lastGyroAt <= HEADING_CONFIG.gyroStaleMs
    ) {
      return {
        angleRad: this.stationaryPdrAngleRad,
        spreadDeg: 75,
        source: 'pdr',
      };
    }

    return null;
  }
}
