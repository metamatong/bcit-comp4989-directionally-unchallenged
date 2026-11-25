/** Browser-only compass and gyroscope estimate for the live facing cone. */
import type { DeviceHeading, RawOrientationSample } from './types';

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

export const HEADING_CONFIG = Object.freeze({
  /** WMM2025 magnetic declination for BCIT Burnaby, degrees East positive. */
  bcitDeclinationDeg: 15.3,
  maxCompassAccuracyDeg: 75,
  /** Heading is unstable when the screen's right axis is nearly vertical. */
  minHorizontalRight: 0.15,
  compassTauSec: 1.5,
  magneticSpikeThresholdRad: 45 * DEG_TO_RAD,
  spikeTauSec: 5,
  spikeConfirmMs: 2_500,
  maxGyroGapMs: 500,
  unconfirmedTurnThresholdRad: 3 * DEG_TO_RAD,
  unconfirmedTurnTimeoutMs: 3_000,
});

type CompassBearing = { bearingRad: number; accuracyDeg?: number };

export function wrapAngleRad(rad: number): number {
  let angle = rad % TWO_PI;
  if (angle <= -Math.PI) angle += TWO_PI;
  if (angle > Math.PI) angle -= TWO_PI;
  return angle;
}

function normalizePositiveRad(rad: number): number {
  const angle = rad % TWO_PI;
  return angle < 0 ? angle + TWO_PI : angle;
}

function spreadForCompassAccuracy(accuracyDeg?: number): number {
  if (accuracyDeg === undefined) return 65;
  if (accuracyDeg <= 20) return 50;
  if (accuracyDeg <= 35) return 65;
  if (accuracyDeg <= 55) return 85;
  return 110;
}

/** Extract clockwise radians from magnetic north in the current screen orientation. */
export function extractMagneticBearingRad(sample: RawOrientationSample): CompassBearing | null {
  const screenAngle = Number.isFinite(sample.screenAngleDeg) ? sample.screenAngleDeg : 0;
  const { webkitCompassHeading, webkitCompassAccuracy } = sample;
  if (webkitCompassHeading != null || webkitCompassAccuracy != null) {
    if (
      webkitCompassHeading == null ||
      !Number.isFinite(webkitCompassHeading) ||
      webkitCompassHeading < 0
    ) {
      return null;
    }
    if (
      webkitCompassAccuracy != null &&
      (!Number.isFinite(webkitCompassAccuracy) ||
        webkitCompassAccuracy < 0 ||
        webkitCompassAccuracy > HEADING_CONFIG.maxCompassAccuracyDeg)
    ) {
      return null;
    }
    return {
      bearingRad: normalizePositiveRad((webkitCompassHeading + screenAngle) * DEG_TO_RAD),
      ...(webkitCompassAccuracy != null ? { accuracyDeg: webkitCompassAccuracy } : {}),
    };
  }

  const { alpha, beta, gamma } = sample;
  if (
    !sample.absolute ||
    alpha == null ||
    beta == null ||
    gamma == null ||
    !Number.isFinite(alpha) ||
    !Number.isFinite(beta) ||
    !Number.isFinite(gamma)
  ) {
    return null;
  }

  const a = alpha * DEG_TO_RAD;
  const b = beta * DEG_TO_RAD;
  const g = gamma * DEG_TO_RAD;
  const screenRad = screenAngle * DEG_TO_RAD;

  // Horizontal components of the device right and top axes in Rz(a) * Rx(b) * Ry(g).
  const deviceRightEast = Math.cos(a) * Math.cos(g) - Math.sin(a) * Math.sin(b) * Math.sin(g);
  const deviceRightNorth = Math.sin(a) * Math.cos(g) + Math.cos(a) * Math.sin(b) * Math.sin(g);
  const deviceTopEast = -Math.sin(a) * Math.cos(b);
  const deviceTopNorth = Math.cos(a) * Math.cos(b);
  const screenRightEast =
    Math.cos(screenRad) * deviceRightEast - Math.sin(screenRad) * deviceTopEast;
  const screenRightNorth =
    Math.cos(screenRad) * deviceRightNorth - Math.sin(screenRad) * deviceTopNorth;
  if (Math.hypot(screenRightEast, screenRightNorth) < HEADING_CONFIG.minHorizontalRight) {
    return null;
  }

  // World up crossed with screen right faces screen-top in a face-up hold and
  // stays continuous when the phone pitches around that right axis.
  return { bearingRad: normalizePositiveRad(Math.atan2(-screenRightNorth, screenRightEast)) };
}

export class HeadingEstimator {
  private compass: (CompassBearing & { timestamp: number }) | null = null;
  private lastGyroAt: number | null = null;
  private gyroTurnRad = 0;
  private unconfirmedTurnAt: number | null = null;
  private spike: { since: number; sign: number } | null = null;

  reset() {
    this.clearCompass();
    this.lastGyroAt = null;
  }

  private clearCompass() {
    this.compass = null;
    this.gyroTurnRad = 0;
    this.unconfirmedTurnAt = null;
    this.spike = null;
  }

  /** Integrate bias-corrected world CCW yaw from the motion tracker. */
  ingestGyroYaw(omegaCcwRadPerSec: number, timestamp: number) {
    if (!Number.isFinite(omegaCcwRadPerSec) || !Number.isFinite(timestamp)) return;
    if (this.lastGyroAt !== null && timestamp <= this.lastGyroAt) return;

    this.expireUnconfirmedTurn(timestamp);
    const previousGyroAt = this.lastGyroAt;
    this.lastGyroAt = timestamp;
    if (!this.compass || previousGyroAt === null) return;

    const elapsedMs = timestamp - Math.max(previousGyroAt, this.compass.timestamp);
    this.gyroTurnRad -= (omegaCcwRadPerSec * elapsedMs) / 1000;
    if (
      this.unconfirmedTurnAt === null &&
      Math.abs(this.gyroTurnRad) >= HEADING_CONFIG.unconfirmedTurnThresholdRad
    ) {
      this.unconfirmedTurnAt = timestamp;
    }
  }

  /** Update the compass anchor, or clear it when the active source reports an unusable reading. */
  ingestCompass(reading: CompassBearing | null, timestamp: number) {
    this.expireUnconfirmedTurn(timestamp);
    if (!reading) {
      this.clearCompass();
      return;
    }

    let bearingRad = reading.bearingRad + HEADING_CONFIG.bcitDeclinationDeg * DEG_TO_RAD;
    if (this.compass && this.lastGyroAt !== null) {
      const predicted = this.compass.bearingRad + this.gyroTurnRad;
      const innovation = wrapAngleRad(bearingRad - predicted);
      let tau: number = HEADING_CONFIG.compassTauSec;

      if (Math.abs(innovation) > HEADING_CONFIG.magneticSpikeThresholdRad) {
        const sign = Math.sign(innovation);
        if (this.spike?.sign !== sign) this.spike = { since: timestamp, sign };
        if (timestamp - this.spike.since < HEADING_CONFIG.spikeConfirmMs) {
          tau = HEADING_CONFIG.spikeTauSec;
        }
      } else {
        this.spike = null;
      }

      const elapsedSec = Math.min(1, (timestamp - this.compass.timestamp) / 1000);
      const correction = elapsedSec > 0 ? 1 - Math.exp(-elapsedSec / tau) : 0;
      bearingRad = predicted + correction * innovation;
    } else {
      this.spike = null;
    }

    this.compass = { ...reading, bearingRad: normalizePositiveRad(bearingRad), timestamp };
    this.gyroTurnRad = 0;
    this.unconfirmedTurnAt = null;
  }

  private expireUnconfirmedTurn(now: number) {
    const gyroLost =
      this.lastGyroAt !== null && now - this.lastGyroAt > HEADING_CONFIG.maxGyroGapMs;
    if (
      this.unconfirmedTurnAt !== null &&
      (gyroLost || now - this.unconfirmedTurnAt >= HEADING_CONFIG.unconfirmedTurnTimeoutMs)
    ) {
      this.clearCompass();
    }
    if (gyroLost) {
      this.lastGyroAt = null;
      this.gyroTurnRad = 0;
    }
  }

  resolvePlanHeading(
    bearingToPlanAngle: (trueBearingRad: number) => number,
    now: number,
  ): DeviceHeading | null {
    this.expireUnconfirmedTurn(now);
    if (!this.compass) return null;

    const { bearingRad, accuracyDeg } = this.compass;
    return {
      angleRad: bearingToPlanAngle(normalizePositiveRad(bearingRad + this.gyroTurnRad)),
      spreadDeg: spreadForCompassAccuracy(accuracyDeg),
      source: this.lastGyroAt === null ? 'compass' : 'compass-gyro',
      ...(accuracyDeg !== undefined ? { accuracyDeg } : {}),
    };
  }
}
