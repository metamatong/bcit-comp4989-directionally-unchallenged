// @vitest-environment jsdom
/**
 * Focused unit and DOM tests for the live directional heading cone:
 * - True North -> floor-plan pixel angle conversion (including rotated plans)
 * - iOS webkitCompassHeading & Android 3D tilt-compensated deviceorientationabsolute
 * - Compass validation, gyro turn limits and guided tracking lifecycle
 * - GuidedDirections SVG cone rendering layered over the uncertainty circle
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { floorGraphs } from '../server/floor-graph';
import { locationCatalogue } from '../server/geolocation';
import { pilotEvidence } from '../server/pilot-evidence';
import { visualPlans } from '../server/visual-data';
import { RouteDirections } from '../src/components/RouteDirections';
import { DevicePosition } from '../src/components/DevicePosition';
import {
  BrowserHeading,
  HEADING_PREWARM_MAX_AGE_MS,
  resetHeadingPrewarmForTests,
  startHeadingPrewarm,
  stopHeadingPrewarm,
} from '../src/location/browser-heading';
import {
  getMotionPermissionState,
  getOrientationPermissionState,
  requestMotionPermission,
  resetMotionPermissionCacheForTests,
} from '../src/location/browser-motion';
import { fitCalibration } from '../src/location/geometry';
import {
  extractMagneticBearingRad,
  extractQuaternionMagneticBearingRad,
  HEADING_CONFIG,
  HeadingEstimator,
  wrapAngleRad,
} from '../src/location/heading';
import type { CalibrationControl } from '../src/location/types';
import { useHeadingPrewarm, useHeadingTracker } from '../src/location/use-heading-tracker';
import type { MapStop, NavigationResult, WalkingSurface } from '../src/wayfinding';
import { walkingRouteFixture } from './wayfinding-fixtures';

const DEG = Math.PI / 180;
const catalogue = locationCatalogue();
const se12Plan = visualPlans.find((plan) => plan.id === 'SE12-F3-p1')!;
const se12Calibration = catalogue.floors.find((floor) => floor.planId === se12Plan.id)!;
const se12Fit = fitCalibration(se12Calibration.controls, se12Plan.width, se12Plan.height);
const se12Floor = floorGraphs().byId.get(se12Plan.id)!;
const se12Surface: WalkingSurface = {
  planId: se12Floor.plan.id,
  sourceSha256: se12Floor.plan.sourceSha256,
  graphVersion: se12Floor.version,
  step: se12Floor.step,
  runs: se12Floor.runs,
};

function makeRouteFixture(): Extract<NavigationResult, { status: 'route' }> {
  const fixture = walkingRouteFixture();
  const stop = (point: Omit<MapStop, 'id'>): MapStop => ({
    ...point,
    id: `${point.planId}:${point.label}`,
  });
  return {
    status: 'route',
    networkRevision: 1,
    origins: [],
    destinations: [],
    origin: stop(fixture.origin),
    destination: stop(fixture.destination),
    steps: fixture.steps.map((s) => ({ ...s, from: stop(s.from), to: stop(s.to) })),
  };
}

afterEach(() => {
  resetHeadingPrewarmForTests();
  resetMotionPermissionCacheForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('calibration bearing-to-plan angle conversion', () => {
  it('maps True North and East bearings accurately on North-up, rotated, and real SE12 plans', () => {
    // Synthetic North-up plan: +East -> +X, +North -> -Y.
    const lat0 = 49.25;
    const lon0 = -123.0;
    const dLat = 10 / 111_195;
    const dLon = 10 / (111_195 * Math.cos(lat0 * DEG));
    const northUpControls: CalibrationControl[] = [
      { label: 'O', latitude: lat0, longitude: lon0, x: 0.5, y: 0.5 },
      { label: 'E', latitude: lat0, longitude: lon0 + dLon, x: 0.6, y: 0.5 },
      { label: 'N', latitude: lat0 + dLat, longitude: lon0, x: 0.5, y: 0.4 },
      { label: 'NE', latitude: lat0 + dLat, longitude: lon0 + dLon, x: 0.6, y: 0.4 },
    ];
    const northUpFit = fitCalibration(northUpControls, 1000, 1000);
    expect(Math.abs(wrapAngleRad(northUpFit.bearingToPlanAngle(0) - -Math.PI / 2))).toBeLessThan(
      0.01,
    );
    expect(Math.abs(wrapAngleRad(northUpFit.bearingToPlanAngle(Math.PI / 2) - 0))).toBeLessThan(
      0.01,
    );

    // 90 deg clockwise-rotated plan: +North -> +X right, +East -> +Y down.
    const rotatedControls: CalibrationControl[] = [
      { label: 'O', latitude: lat0, longitude: lon0, x: 0.5, y: 0.5 },
      { label: 'E', latitude: lat0, longitude: lon0 + dLon, x: 0.5, y: 0.6 },
      { label: 'N', latitude: lat0 + dLat, longitude: lon0, x: 0.6, y: 0.5 },
      { label: 'NE', latitude: lat0 + dLat, longitude: lon0 + dLon, x: 0.6, y: 0.6 },
    ];
    const rotatedFit = fitCalibration(rotatedControls, 1000, 1000);
    expect(Math.abs(wrapAngleRad(rotatedFit.bearingToPlanAngle(0) - 0))).toBeLessThan(0.01);
    expect(
      Math.abs(wrapAngleRad(rotatedFit.bearingToPlanAngle(Math.PI / 2) - Math.PI / 2)),
    ).toBeLessThan(0.01);

    // Real SE12-F3-p1 calibration: bearingToPlanAngle(0) matches finite-difference North projection.
    const p0 = se12Fit.project(se12Calibration.controls[0]);
    const pNorth = se12Fit.project({
      latitude: se12Calibration.controls[0].latitude + 0.0001,
      longitude: se12Calibration.controls[0].longitude,
    });
    const expectedNorthAngle = Math.atan2(
      (pNorth.y - p0.y) * se12Plan.height,
      (pNorth.x - p0.x) * se12Plan.width,
    );
    expect(Math.abs(wrapAngleRad(se12Fit.bearingToPlanAngle(0) - expectedNorthAngle))).toBeLessThan(
      0.005,
    );
  });
});

describe('extractMagneticBearingRad (iOS Safari & Android Chrome tilt compensation)', () => {
  it('uses iOS webkitCompassHeading with screen rotation and rejects poor/uncalibrated accuracy', () => {
    const portrait = extractMagneticBearingRad({
      alpha: 0,
      beta: 0,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 15,
      screenAngleDeg: 0,
    });
    expect(portrait).toEqual({ bearingRad: Math.PI / 2, accuracyDeg: 15 });

    // Landscape-left (+90 deg): physical top points West (270) while screen top faces North (0).
    const landscape = extractMagneticBearingRad({
      alpha: null,
      beta: null,
      gamma: null,
      absolute: false,
      webkitCompassHeading: 270,
      webkitCompassAccuracy: 18,
      screenAngleDeg: 90,
    });
    expect(Math.abs(wrapAngleRad(landscape!.bearingRad - 0))).toBeLessThan(1e-6);

    const sample = { alpha: null, beta: null, gamma: null, absolute: false, screenAngleDeg: 0 };
    for (const webkitCompassHeading of [null, -1, NaN, Infinity]) {
      expect(
        extractMagneticBearingRad({ ...sample, webkitCompassHeading, webkitCompassAccuracy: 15 }),
      ).toBeNull();
    }
    const indoorWide = extractMagneticBearingRad({
      ...sample,
      webkitCompassHeading: 45,
      webkitCompassAccuracy: 60,
    });
    expect(indoorWide).toEqual({ bearingRad: 45 * DEG, accuracyDeg: 60 });
    const wideEstimator = new HeadingEstimator();
    wideEstimator.ingestCompass(indoorWide, 1000);
    expect(wideEstimator.resolvePlanHeading((angle) => angle, 1000)?.spreadDeg).toBe(110);

    for (const webkitCompassAccuracy of [-1, 80, NaN]) {
      expect(
        extractMagneticBearingRad({ ...sample, webkitCompassHeading: 45, webkitCompassAccuracy }),
      ).toBeNull();
    }
  });

  it('computes consistent Android absolute bearings across pitched, upright, rolled, and landscape holds', () => {
    // Reject non-absolute W3C orientation events (relative alpha is not North-referenced).
    expect(
      extractMagneticBearingRad({
        alpha: 270,
        beta: 0,
        gamma: 0,
        absolute: false,
        screenAngleDeg: 0,
      }),
    ).toBeNull();

    // Facing East (90 deg magnetic) across flat (beta=0), 45 deg tilt, and upright portrait (beta=90).
    for (const beta of [-65, -46, -44, 0, 35, 45, 65, 90]) {
      const sample = extractMagneticBearingRad({
        alpha: 270,
        beta,
        gamma: 0,
        absolute: true,
        screenAngleDeg: 0,
      });
      expect(sample).not.toBeNull();
      expect(Math.abs(wrapAngleRad(sample!.bearingRad - Math.PI / 2))).toBeLessThan(1e-4);
    }

    expect(
      extractMagneticBearingRad({
        alpha: 0,
        beta: 0,
        gamma: 89,
        absolute: true,
        screenAngleDeg: 0,
      }),
    ).toBeNull();

    // Rolling the upright portrait hold changes the horizontal facing estimate to 345 degrees.
    const rolled = extractMagneticBearingRad({
      alpha: 0,
      beta: 90,
      gamma: 15,
      absolute: true,
      screenAngleDeg: 0,
    });
    expect(rolled).not.toBeNull();
    expect(Math.abs(wrapAngleRad(rolled!.bearingRad - 345 * DEG))).toBeLessThan(1e-4);

    // Landscape-left flat (alpha=90, beta=0, screenAngle=90): screen top faces North (0 deg).
    const landscapeFlat = extractMagneticBearingRad({
      alpha: 90,
      beta: 0,
      gamma: 0,
      absolute: true,
      screenAngleDeg: 90,
    });
    expect(landscapeFlat).not.toBeNull();
    expect(Math.abs(wrapAngleRad(landscapeFlat!.bearingRad - 0))).toBeLessThan(1e-4);
  });

  it('extracts matching bearings from AbsoluteOrientationSensor quaternions and rejects degenerate poses', () => {
    const eulerToQuaternion = (
      alphaDeg: number,
      betaDeg: number,
      gammaDeg: number,
    ): [number, number, number, number] => {
      // Intrinsic Z-X-Y (alpha, beta, gamma) -> Rz(a) * Rx(b) * Ry(g)
      const ca = Math.cos((alphaDeg * DEG) / 2);
      const sa = Math.sin((alphaDeg * DEG) / 2);
      const cb = Math.cos((betaDeg * DEG) / 2);
      const sb = Math.sin((betaDeg * DEG) / 2);
      const cg = Math.cos((gammaDeg * DEG) / 2);
      const sg = Math.sin((gammaDeg * DEG) / 2);
      const mul = (
        a: [number, number, number, number],
        b: [number, number, number, number],
      ): [number, number, number, number] => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
      ];
      return mul(mul([0, 0, sa, ca], [sb, 0, 0, cb]), [0, sg, 0, cg]);
    };

    const poses = [
      { alpha: 270, beta: 0, gamma: 0, screenAngleDeg: 0, expectedDeg: 90 },
      { alpha: 270, beta: 45, gamma: 0, screenAngleDeg: 0, expectedDeg: 90 },
      { alpha: 270, beta: 90, gamma: 0, screenAngleDeg: 0, expectedDeg: 90 },
      { alpha: 0, beta: 90, gamma: 15, screenAngleDeg: 0, expectedDeg: 345 },
      { alpha: 90, beta: 0, gamma: 0, screenAngleDeg: 90, expectedDeg: 0 },
    ];
    for (const pose of poses) {
      const q = eulerToQuaternion(pose.alpha, pose.beta, pose.gamma);
      const fromQuat = extractQuaternionMagneticBearingRad({
        quaternion: q,
        screenAngleDeg: pose.screenAngleDeg,
      });
      const fromEuler = extractMagneticBearingRad({
        alpha: pose.alpha,
        beta: pose.beta,
        gamma: pose.gamma,
        absolute: true,
        screenAngleDeg: pose.screenAngleDeg,
      });
      expect(fromQuat).not.toBeNull();
      expect(Math.abs(wrapAngleRad(fromQuat!.bearingRad - pose.expectedDeg * DEG))).toBeLessThan(
        1e-4,
      );
      expect(Math.abs(wrapAngleRad(fromQuat!.bearingRad - fromEuler!.bearingRad))).toBeLessThan(
        1e-5,
      );
    }

    // Sideways roll (~89 deg) and invalid/zero-norm quaternions return null.
    expect(
      extractQuaternionMagneticBearingRad({
        quaternion: eulerToQuaternion(0, 0, 89),
        screenAngleDeg: 0,
      }),
    ).toBeNull();
    for (const quaternion of [
      null,
      [0, 0, 0, 0] as const,
      [NaN, 0, 0, 1] as const,
      [Infinity, 0, 0, 1] as const,
    ]) {
      expect(extractQuaternionMagneticBearingRad({ quaternion, screenAngleDeg: 0 })).toBeNull();
    }
  });
});

describe('HeadingEstimator', () => {
  const identity = (bearing: number) => bearing;
  const declination = HEADING_CONFIG.bcitDeclinationDeg * DEG;

  it('keeps a quiet compass bearing and applies the next compass-only reading directly', () => {
    const estimator = new HeadingEstimator();
    estimator.ingestCompass({ bearingRad: 0 }, 1000);
    expect(estimator.resolvePlanHeading(identity, 60_000)?.angleRad).toBeCloseTo(declination);
    estimator.ingestCompass({ bearingRad: Math.PI / 2 }, 60_100);
    expect(estimator.resolvePlanHeading(identity, 120_000)?.angleRad).toBeCloseTo(
      Math.PI / 2 + declination,
    );
  });

  it('follows a gyro pivot from a compass anchor while damping a brief magnetic spike', () => {
    const estimator = new HeadingEstimator();
    estimator.ingestGyroYaw(0, 1000);
    expect(estimator.resolvePlanHeading(identity, 1000)).toBeNull();
    estimator.ingestCompass({ bearingRad: 0, accuracyDeg: 15 }, 1000);

    const initial = estimator.resolvePlanHeading(identity, 1000)!;
    expect(initial).toMatchObject({ source: 'compass-gyro', spreadDeg: 50 });
    expect(initial.angleRad).toBeCloseTo(declination);

    for (let t = 1100; t <= 1400; t += 100) {
      estimator.ingestGyroYaw(0, t);
      estimator.ingestCompass({ bearingRad: Math.PI / 2, accuracyDeg: 15 }, t);
    }
    const afterSpike = estimator.resolvePlanHeading(identity, 1400)!;
    expect(Math.abs(wrapAngleRad(afterSpike.angleRad - initial.angleRad))).toBeLessThan(10 * DEG);

    for (let t = 1500; t <= 2400; t += 100) {
      estimator.ingestGyroYaw(Math.PI / 2, t);
    }
    const afterTurn = estimator.resolvePlanHeading(identity, 2400)!;
    expect(wrapAngleRad(afterTurn.angleRad - afterSpike.angleRad)).toBeCloseTo(-Math.PI / 2);
  });
});

function dispatchOrientation(target: EventTarget, type: string, fields: object) {
  target.dispatchEvent(Object.assign(new Event(type), fields));
}

describe('BrowserHeading', () => {
  it.each(['gyro gap', 'compass timeout'])('clears an unconfirmed turn after a %s', (failure) => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    const target = new EventTarget();
    const adapter = new BrowserHeading((angle) => angle, target);
    const onHeading = vi.fn();
    const north = { alpha: 0, beta: 0, gamma: 0 };

    try {
      adapter.start(onHeading);
      adapter.ingestGyroYaw(Math.PI / 2, Date.now());
      expect(onHeading).not.toHaveBeenCalled();

      dispatchOrientation(target, 'deviceorientationabsolute', north);
      const initial = onHeading.mock.lastCall![0];
      expect(initial).toMatchObject({ source: 'compass-gyro' });

      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(100);
        adapter.ingestGyroYaw(Math.PI / 2, Date.now());
      }
      expect(wrapAngleRad(onHeading.mock.lastCall![0].angleRad - initial.angleRad)).toBeCloseTo(
        -Math.PI / 2,
      );

      if (failure === 'gyro gap') {
        vi.advanceTimersByTime(750);
      } else {
        for (let i = 0; i < 21; i++) {
          vi.advanceTimersByTime(100);
          adapter.ingestGyroYaw(0, Date.now());
        }
      }
      expect(onHeading).toHaveBeenLastCalledWith(null);

      adapter.ingestGyroYaw(Math.PI / 2, Date.now());
      expect(onHeading).toHaveBeenLastCalledWith(null);
      dispatchOrientation(target, 'deviceorientationabsolute', { ...north, alpha: 90 });
      expect(onHeading.mock.lastCall![0].angleRad).toBeCloseTo(
        (270 + HEADING_CONFIG.bcitDeclinationDeg) * DEG,
      );
    } finally {
      adapter.stop();
    }
  });

  it('ignores relative events and clears a bearing when its absolute source reports unavailable', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    const target = new EventTarget();
    const adapter = new BrowserHeading((angle) => angle, target);
    const onHeading = vi.fn();
    const unavailable = { alpha: null, beta: null, gamma: null };
    try {
      adapter.start(onHeading);
      dispatchOrientation(target, 'deviceorientationabsolute', unavailable);
      dispatchOrientation(target, 'deviceorientation', {
        alpha: 0,
        beta: 0,
        gamma: 0,
        absolute: true,
      });
      expect(onHeading).toHaveBeenCalledTimes(1);

      dispatchOrientation(target, 'deviceorientation', { ...unavailable, absolute: false });
      dispatchOrientation(target, 'deviceorientationabsolute', unavailable);
      expect(onHeading).toHaveBeenCalledTimes(1);

      dispatchOrientation(target, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      dispatchOrientation(target, 'deviceorientationabsolute', unavailable);
      expect(onHeading).toHaveBeenLastCalledWith(null);

      // Once deviceorientationabsolute has produced a valid reading, fallback deviceorientation
      // events must not hijack the stream after a momentary invalid sample.
      const callsBeforeFallback = onHeading.mock.calls.length;
      dispatchOrientation(target, 'deviceorientation', {
        alpha: 90,
        beta: 0,
        gamma: 0,
        absolute: true,
      });
      expect(onHeading).toHaveBeenCalledTimes(callsBeforeFallback);
    } finally {
      adapter.stop();
    }
  });

  it('keeps a steady bearing when the gyro falls silent and orientation does not change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    const target = new EventTarget();
    const adapter = new BrowserHeading((angle) => angle, target);
    const onHeading = vi.fn();
    try {
      adapter.start(onHeading);
      adapter.ingestGyroYaw(0, Date.now());
      dispatchOrientation(target, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      const initial = onHeading.mock.lastCall![0];
      vi.advanceTimersByTime(60_000);
      expect(onHeading).toHaveBeenLastCalledWith({ ...initial, source: 'compass' });
    } finally {
      adapter.stop();
    }
  });

  it('prefers AbsoluteOrientationSensor when available and falls back to deviceorientationabsolute on error', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    const instances: FakeAbsoluteSensor[] = [];
    class FakeAbsoluteSensor extends EventTarget {
      quaternion: [number, number, number, number] | null = null;
      started = false;
      stopped = false;
      constructor(public readonly options?: { frequency?: number; referenceFrame?: string }) {
        super();
        instances.push(this);
      }
      start() {
        this.started = true;
      }
      stop() {
        this.stopped = true;
      }
    }
    vi.stubGlobal('AbsoluteOrientationSensor', FakeAbsoluteSensor);

    const target = new EventTarget();
    const adapter = new BrowserHeading((angle) => angle, target);
    const onHeading = vi.fn();
    try {
      adapter.start(onHeading);
      expect(instances).toHaveLength(1);
      expect(instances[0].started).toBe(true);
      expect(instances[0].options).toEqual({ frequency: 15, referenceFrame: 'device' });

      // Flat facing East (alpha=270 -> q = [0, 0, -sqrt(2)/2, sqrt(2)/2]).
      instances[0].quaternion = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];
      instances[0].dispatchEvent(new Event('reading'));
      expect(onHeading).toHaveBeenCalledTimes(1);
      expect(onHeading.mock.lastCall![0].angleRad).toBeCloseTo(
        (90 + HEADING_CONFIG.bcitDeclinationDeg) * DEG,
      );

      // Once AbsoluteOrientationSensor has emitted a valid bearing, fallback events do not overwrite it.
      dispatchOrientation(target, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      expect(onHeading).toHaveBeenCalledTimes(1);

      // Runtime sensor error detaches the sensor, clears its bearing, and allows fallback events to recover.
      instances[0].dispatchEvent(new Event('error'));
      expect(instances[0].stopped).toBe(true);
      expect(onHeading).toHaveBeenLastCalledWith(null);

      dispatchOrientation(target, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      expect(onHeading.mock.lastCall![0].angleRad).toBeCloseTo(
        HEADING_CONFIG.bcitDeclinationDeg * DEG,
      );
    } finally {
      adapter.stop();
    }
  });

  it('falls back cleanly when AbsoluteOrientationSensor throws on construction', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    vi.stubGlobal(
      'AbsoluteOrientationSensor',
      class {
        constructor() {
          throw new DOMException('Blocked by Permissions-Policy', 'SecurityError');
        }
      },
    );
    const target = new EventTarget();
    const adapter = new BrowserHeading((angle) => angle, target);
    const onHeading = vi.fn();
    try {
      adapter.start(onHeading);
      dispatchOrientation(target, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      expect(onHeading).toHaveBeenCalledTimes(1);
    } finally {
      adapter.stop();
    }
  });
});

describe('heading pre-warm handoff', () => {
  it('accepts an absolute event when the guided sensor fails to start after pre-warming', () => {
    vi.useFakeTimers();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    const sensors: EventTarget[] = [];
    vi.stubGlobal(
      'AbsoluteOrientationSensor',
      class extends EventTarget {
        readonly quaternion = [0, 0, 0, 1];

        constructor() {
          super();
          if (sensors.length) throw Error('Guided sensor unavailable');
          sensors.push(this);
        }

        start() {}
        stop() {}
      },
    );
    const onHeading = vi.fn();
    const heading = new BrowserHeading((angle) => angle);
    startHeadingPrewarm();
    sensors[0].dispatchEvent(new Event('reading'));

    try {
      heading.start(onHeading);
      stopHeadingPrewarm();
      expect(onHeading.mock.lastCall?.[0].angleRad).toBeCloseTo(
        HEADING_CONFIG.bcitDeclinationDeg * DEG,
      );
      vi.advanceTimersByTime(100);
      dispatchOrientation(window, 'deviceorientationabsolute', { alpha: 270, beta: 0, gamma: 0 });
      expect(onHeading.mock.lastCall?.[0].angleRad).toBeCloseTo(
        (90 + HEADING_CONFIG.bcitDeclinationDeg) * DEG,
      );
    } finally {
      heading.stop();
    }
  });

  it('seeds useHeadingTracker immediately on mount from a fresh pre-warmed reading while preserving reset rules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);

    const host = document.createElement('div');
    const root = createRoot(host);
    const northUp = (angle: number) => angle - Math.PI / 2;
    const rotated = (angle: number) => angle;
    function Harness({
      prewarm,
      track,
      project,
    }: {
      prewarm: boolean;
      track: boolean;
      project: (angle: number) => number;
    }) {
      useHeadingPrewarm(prewarm);
      const { heading } = useHeadingTracker({ active: track, bearingToPlanAngle: project });
      return createElement('output', null, heading ? heading.angleRad.toFixed(2) : '');
    }
    const render = (prewarm: boolean, track: boolean, project: (angle: number) => number) =>
      act(async () => root.render(createElement(Harness, { prewarm, track, project })));

    try {
      // Pre-warm on destination/loading screen before GuidedDirections mounts.
      await render(true, false, northUp);
      await act(async () => {
        dispatchOrientation(window, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      });
      expect(host.textContent).toBe('');

      // GuidedDirections mounts: heading is immediately seeded on frame 1 without a new orientation event.
      await render(false, true, northUp);
      expect(host.textContent).toBe('-1.30');

      // Handoff is one-shot: a subsequent calibration change still clears heading until a fresh event.
      await render(false, true, rotated);
      expect(host.textContent).toBe('');

      // Backgrounding during pre-warm discards the cached reading so Step 1 starts empty.
      await render(true, false, northUp);
      await act(async () => {
        dispatchOrientation(window, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      });
      await act(async () => {
        hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {
        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await render(false, true, northUp);
      expect(host.textContent).toBe('');

      // Pre-warmed reading older than HEADING_PREWARM_MAX_AGE_MS is ignored on handoff.
      await render(false, false, northUp);
      startHeadingPrewarm();
      dispatchOrientation(window, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 });
      vi.advanceTimersByTime(HEADING_PREWARM_MAX_AGE_MS + 1);
      await render(false, true, northUp);
      expect(host.textContent).toBe('');
      stopHeadingPrewarm();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe('useHeadingTracker lifecycle', () => {
  it('requires a new compass reading after calibration change, backgrounding, or guidance pause', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const host = document.createElement('div');
    const root = createRoot(host);
    const northUp = (angle: number) => angle - Math.PI / 2;
    const rotated = (angle: number) => angle;
    function Probe({ active, project }: { active: boolean; project: (angle: number) => number }) {
      const { heading } = useHeadingTracker({ active, bearingToPlanAngle: project });
      return createElement('output', null, heading ? heading.angleRad.toFixed(2) : '');
    }
    const render = (active: boolean, project: (angle: number) => number) =>
      act(async () => root.render(createElement(Probe, { active, project })));
    const compass = () =>
      act(async () =>
        dispatchOrientation(window, 'deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0 }),
      );
    const changeVisibility = (next: boolean) =>
      act(async () => {
        hidden = next;
        document.dispatchEvent(new Event('visibilitychange'));
      });

    try {
      await render(true, northUp);
      await compass();
      expect(host.textContent).toBe('-1.30');

      await render(true, rotated);
      expect(host.textContent).toBe('');
      await compass();
      expect(host.textContent).toBe('0.27');

      await changeVisibility(true);
      await compass();
      expect(host.textContent).toBe('');
      await changeVisibility(false);
      expect(host.textContent).toBe('');
      await compass();
      expect(host.textContent).toBe('0.27');

      await render(false, rotated);
      await compass();
      expect(host.textContent).toBe('');
      await render(true, rotated);
      expect(host.textContent).toBe('');
      await compass();
      expect(host.textContent).toBe('0.27');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe('iOS synchronous sensor permission request', () => {
  it('invokes both Motion and Orientation requestPermission() synchronously in one user gesture', async () => {
    vi.stubGlobal('isSecureContext', true);
    let resolveMotion!: (value: 'granted' | 'denied') => void;
    let resolveOrient!: (value: 'granted' | 'denied') => void;
    const requestMotion = vi.fn(
      () => new Promise<'granted' | 'denied'>((resolve) => (resolveMotion = resolve)),
    );
    const requestOrientation = vi.fn(
      () => new Promise<'granted' | 'denied'>((resolve) => (resolveOrient = resolve)),
    );
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: requestMotion });
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: requestOrientation });

    const pending = requestMotionPermission();
    // Both must be called synchronously before the first promise settles so WebKit keeps user activation.
    expect(requestMotion).toHaveBeenCalledTimes(1);
    expect(requestOrientation).toHaveBeenCalledTimes(1);
    // Duplicate taps while the modal is open share the in-flight request without re-prompting.
    expect(requestMotionPermission()).toBe(pending);

    resolveMotion('granted');
    resolveOrient('granted');
    expect(await pending).toBe('granted');
    expect(getMotionPermissionState()).toBe('granted');
    expect(getOrientationPermissionState()).toBe('granted');
  });

  it('keeps orientation retryable on NotAllowedError without re-requesting granted motion', async () => {
    vi.stubGlobal('isSecureContext', true);
    const requestMotion = vi.fn<() => Promise<'granted' | 'denied'>>().mockResolvedValue('granted');
    const requestOrientation = vi
      .fn<() => Promise<'granted' | 'denied'>>()
      .mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'))
      .mockResolvedValueOnce('granted');
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: requestMotion });
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: requestOrientation });

    await requestMotionPermission();
    expect(getMotionPermissionState()).toBe('granted');
    expect(getOrientationPermissionState()).toBe('unknown');

    await requestMotionPermission();
    expect(requestMotion).toHaveBeenCalledTimes(1);
    expect(requestOrientation).toHaveBeenCalledTimes(2);
    expect(getOrientationPermissionState()).toBe('granted');
  });
});

describe('GuidedDirections heading cone DOM integration', () => {
  it.each(['granted', 'denied'] as const)(
    'gates the cone on iOS orientation permission (%s)',
    async (permission) => {
      vi.useFakeTimers();
      vi.setSystemTime(20_000);
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('isSecureContext', true);
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

      const requestMotion = vi
        .fn<() => Promise<'granted' | 'denied'>>()
        .mockResolvedValue(permission);
      const requestOrientation = vi
        .fn<() => Promise<'granted' | 'denied'>>()
        .mockResolvedValue(permission);
      vi.stubGlobal('DeviceMotionEvent', { requestPermission: requestMotion });
      vi.stubGlobal('DeviceOrientationEvent', { requestPermission: requestOrientation });

      let reportLocation: PositionCallback = () => {};
      vi.stubGlobal('navigator', {
        geolocation: {
          watchPosition: vi.fn((success: PositionCallback) => {
            reportLocation = success;
            return 9;
          }),
          clearWatch: vi.fn(),
        },
      });

      const route = makeRouteFixture();
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () =>
          root.render(
            createElement(RouteDirections, {
              route,
              plans: pilotEvidence().map((p) => p.plan),
              locationCatalogue: catalogue,
              walkingSurfaces: { [se12Plan.id]: se12Surface },
              onRecheck: vi.fn(),
            }),
          ),
        );

        const initialViewBox = host.querySelector('.walking-map')?.getAttribute('viewBox');
        const pt = se12Fit.unproject({
          x: (200.5 * se12Surface.step) / se12Plan.width,
          y: (133.5 * se12Surface.step) / se12Plan.height,
        });
        await act(async () =>
          reportLocation({
            coords: { latitude: pt.latitude, longitude: pt.longitude, accuracy: 7 },
            timestamp: Date.now(),
          } as GeolocationPosition),
        );

        // Before iOS Motion & Orientation permission is resolved, dot + circle render with no cone and no manual compass button.
        expect(host.querySelector('.device-position ellipse')).not.toBeNull();
        expect(host.querySelector('.device-position circle')).not.toBeNull();
        expect(host.querySelector('.map-compass-btn')).toBeNull();
        expect(host.querySelector('.device-heading-cone')).toBeNull();

        // Any fallback tap inside the guided view unlocks both Motion & Orientation synchronously on iOS.
        await act(async () => {
          host
            .querySelector('.guided-map')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(requestMotion).toHaveBeenCalledTimes(1);
        expect(requestOrientation).toHaveBeenCalledTimes(1);
        expect(host.querySelector('.map-compass-btn')).toBeNull();

        // Dispatch an iOS compass event while standing still -> cone appears over the uncertainty ellipse.
        const orient1 = new Event('deviceorientation');
        Object.assign(orient1, { webkitCompassHeading: 0, webkitCompassAccuracy: 15 });
        await act(async () => {
          window.dispatchEvent(orient1);
        });

        const cone1 = host.querySelector('.device-heading-cone');
        if (permission === 'denied') {
          expect(cone1).toBeNull();
          expect(host.querySelector('.device-position circle')).not.toBeNull();
          return;
        }
        expect(cone1).not.toBeNull();
        expect(cone1?.getAttribute('data-heading-source')).toBe('compass');
        const firstPath = cone1?.getAttribute('d');
        expect(host.querySelector('.walking-map')?.getAttribute('viewBox')).toBe(initialViewBox);

        // Turning 90 deg clockwise rotates the cone cleanly without changing viewBox.
        await act(async () => {
          vi.advanceTimersByTime(150);
          const orient2 = new Event('deviceorientation');
          Object.assign(orient2, { webkitCompassHeading: 90, webkitCompassAccuracy: 15 });
          window.dispatchEvent(orient2);
        });
        expect(host.querySelector('.device-heading-cone')?.getAttribute('d')).not.toBe(firstPath);
        expect(host.querySelector('.walking-map')?.getAttribute('viewBox')).toBe(initialViewBox);

        await act(async () =>
          dispatchOrientation(window, 'deviceorientation', {
            webkitCompassHeading: -1,
            webkitCompassAccuracy: 15,
          }),
        );
        expect(host.querySelector('.device-heading-cone')).toBeNull();
        expect(host.querySelector('.device-position circle')).not.toBeNull();
        await act(async () =>
          dispatchOrientation(window, 'deviceorientation', {
            webkitCompassHeading: 90,
            webkitCompassAccuracy: 15,
          }),
        );
        expect(host.querySelector('.device-heading-cone')).not.toBeNull();

        // Past GPS hold expiry (> 8 s), hollow last-known marker appears with NO heading cone.
        await act(async () => vi.advanceTimersByTime(9_000));
        expect(host.querySelector('.last-known-position')).not.toBeNull();
        expect(host.querySelector('.device-heading-cone')).toBeNull();
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it('attaches heading tracking when Back to steps resolves iOS permission after GuidedDirections mounts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

    let resolveMotion!: (value: 'granted' | 'denied') => void;
    let resolveOrient!: (value: 'granted' | 'denied') => void;
    vi.stubGlobal('DeviceMotionEvent', {
      requestPermission: vi.fn(
        () => new Promise<'granted' | 'denied'>((resolve) => (resolveMotion = resolve)),
      ),
    });
    vi.stubGlobal('DeviceOrientationEvent', {
      requestPermission: vi.fn(
        () => new Promise<'granted' | 'denied'>((resolve) => (resolveOrient = resolve)),
      ),
    });

    let reportLocation: PositionCallback = () => {};
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: vi.fn((success: PositionCallback) => {
          reportLocation = success;
          return 12;
        }),
        clearWatch: vi.fn(),
      },
    });

    const route = makeRouteFixture();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          createElement(RouteDirections, {
            route,
            plans: pilotEvidence().map((p) => p.plan),
            locationCatalogue: catalogue,
            walkingSurfaces: { [se12Plan.id]: se12Surface },
            onRecheck: vi.fn(),
          }),
        ),
      );

      // Switch to Overview (does not prompt on exit), then tap Back to steps while the iOS prompt remains pending.
      await act(async () => {
        host
          .querySelector('.map-overview-btn')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        host
          .querySelector('.overview-back-pill')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(host.querySelector('.map-compass-btn')).toBeNull();

      const pt = se12Fit.unproject({
        x: (200.5 * se12Surface.step) / se12Plan.width,
        y: (133.5 * se12Surface.step) / se12Plan.height,
      });
      await act(async () =>
        reportLocation({
          coords: { latitude: pt.latitude, longitude: pt.longitude, accuracy: 7 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );

      // Resolve the pending iOS prompt AFTER GuidedDirections has already mounted.
      await act(async () => {
        resolveMotion('granted');
        resolveOrient('granted');
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.querySelector('.map-compass-btn')).toBeNull();

      await act(async () =>
        dispatchOrientation(window, 'deviceorientation', {
          webkitCompassHeading: 45,
          webkitCompassAccuracy: 20,
        }),
      );
      expect(host.querySelector('.device-heading-cone')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('catches immediate microtask resolution on Back to steps, ignores taps when GPS is denied, and unlocks via any guided tap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

    const requestMotion = vi.fn(() => Promise.resolve<'granted'>('granted'));
    const requestOrientation = vi.fn(() => Promise.resolve<'granted'>('granted'));
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: requestMotion });
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: requestOrientation });

    let reportLocation: PositionCallback = () => {};
    let reportError: PositionErrorCallback = () => {};
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
          reportLocation = success;
          reportError = error ?? (() => {});
          return 15;
        }),
        clearWatch: vi.fn(),
      },
    });

    const route = makeRouteFixture();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          createElement(RouteDirections, {
            route,
            plans: pilotEvidence().map((p) => p.plan),
            locationCatalogue: catalogue,
            walkingSurfaces: { [se12Plan.id]: se12Surface },
            onRecheck: vi.fn(),
          }),
        ),
      );

      // 1. Immediate microtask grant on Overview -> Back to steps must attach heading via useSyncExternalStore.
      await act(async () => {
        host
          .querySelector('.map-overview-btn')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(requestOrientation).not.toHaveBeenCalled();
      await act(async () => {
        host
          .querySelector('.overview-back-pill')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(requestOrientation).toHaveBeenCalledTimes(1);
      expect(host.querySelector('.map-compass-btn')).toBeNull();

      const pt = se12Fit.unproject({
        x: (200.5 * se12Surface.step) / se12Plan.width,
        y: (133.5 * se12Surface.step) / se12Plan.height,
      });
      await act(async () =>
        reportLocation({
          coords: { latitude: pt.latitude, longitude: pt.longitude, accuracy: 7 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );
      await act(async () =>
        dispatchOrientation(window, 'deviceorientation', {
          webkitCompassHeading: 30,
          webkitCompassAccuracy: 15,
        }),
      );
      expect(host.querySelector('.device-heading-cone')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }

    // 2. When GPS is denied (canTrack -> false), tapping the guided screen does not prompt for compass.
    resetMotionPermissionCacheForTests();
    requestMotion.mockClear();
    requestOrientation.mockClear();
    const host2 = document.createElement('div');
    document.body.append(host2);
    const root2 = createRoot(host2);
    try {
      await act(async () =>
        root2.render(
          createElement(RouteDirections, {
            route,
            plans: pilotEvidence().map((p) => p.plan),
            locationCatalogue: catalogue,
            walkingSurfaces: { [se12Plan.id]: se12Surface },
            onRecheck: vi.fn(),
          }),
        ),
      );
      expect(host2.querySelector('.map-compass-btn')).toBeNull();

      await act(async () => {
        reportError({ code: 1, message: 'Denied' } as GeolocationPositionError);
      });
      await act(async () => {
        host2
          .querySelector('.guided-map')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
      expect(requestOrientation).not.toHaveBeenCalled();
    } finally {
      await act(async () => root2.unmount());
      host2.remove();
    }

    // 3. If permission was already granted earlier (e.g. on Get Directions) and pre-warmed,
    // Step 1 renders the cone automatically without any extra button click.
    resetMotionPermissionCacheForTests();
    requestMotion.mockClear();
    requestOrientation.mockClear();
    await requestMotionPermission();
    startHeadingPrewarm();
    dispatchOrientation(window, 'deviceorientation', {
      webkitCompassHeading: 30,
      webkitCompassAccuracy: 15,
    });
    const host3 = document.createElement('div');
    document.body.append(host3);
    const root3 = createRoot(host3);
    try {
      await act(async () =>
        root3.render(
          createElement(RouteDirections, {
            route,
            plans: pilotEvidence().map((p) => p.plan),
            locationCatalogue: catalogue,
            walkingSurfaces: { [se12Plan.id]: se12Surface },
            onRecheck: vi.fn(),
          }),
        ),
      );
      const pt = se12Fit.unproject({
        x: (200.5 * se12Surface.step) / se12Plan.width,
        y: (133.5 * se12Surface.step) / se12Plan.height,
      });
      await act(async () =>
        reportLocation({
          coords: { latitude: pt.latitude, longitude: pt.longitude, accuracy: 7 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );
      expect(host3.querySelector('.map-compass-btn')).toBeNull();
      expect(host3.querySelector('.device-heading-cone')).not.toBeNull();
    } finally {
      stopHeadingPrewarm();
      await act(async () => root3.unmount());
      host3.remove();
    }
  });
});

describe('DevicePosition full-ring radar sector', () => {
  it('spans 100% of the uncertainty ellipse with rays and highlighted arc in matched and raw modes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    const root = createRoot(host);
    const overlay = {
      point: { x: 0.25, y: 0.5 },
      radiusX: 0.05,
      radiusY: 0.08,
      uncertaintyRadiusMetres: 6,
      corridorMatched: true,
      trackingMode: 'matched' as const,
    };
    const heading = { angleRad: 0, spreadDeg: 50, source: 'compass' as const, accuracyDeg: 18 };
    const render = (props: Parameters<typeof DevicePosition>[0]) =>
      act(async () =>
        root.render(createElement('svg', null, createElement(DevicePosition, props))),
      );

    try {
      // Corridor-matched with active heading: sector and arc match full rx/ry (50, 80).
      await render({ overlay, heading, width: 1000, height: 1000 });
      const cone = host.querySelector('.device-heading-cone');
      const rays = host.querySelector('.device-heading-rays');
      const arc = host.querySelector('.device-heading-arc');
      const ellipse = host.querySelector('.device-position ellipse');
      const gradientId = host.querySelector('.device-position radialGradient')?.getAttribute('id');
      const filterId = host.querySelector('.device-position filter')?.getAttribute('id');
      const shadow = host.querySelector('.device-position feDropShadow');
      expect(gradientId).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(filterId).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(Number(shadow?.getAttribute('dy'))).toBeCloseTo(1, 5);
      expect(Number(shadow?.getAttribute('stdDeviation'))).toBeCloseTo(1.52, 5);
      expect(cone?.getAttribute('d')).toContain('A 50 80 0 0 1');

      // High-resolution plan scales drop-shadow proportionally with dotR.
      await render({ overlay, heading, width: 3000, height: 3000 });
      const scaledShadow = host.querySelector('.device-position feDropShadow');
      expect(Number(scaledShadow?.getAttribute('dy'))).toBeCloseTo(3, 5);
      expect(Number(scaledShadow?.getAttribute('stdDeviation'))).toBeCloseTo(4.56, 5);
      await render({ overlay, heading, width: 1000, height: 1000 });
      expect(arc?.getAttribute('d')).toContain('A 50 80 0 0 1');
      expect(rays?.getAttribute('stroke')).toBe('#0f766e');
      expect(arc?.getAttribute('stroke')).toBe('#0f766e');
      expect(ellipse?.getAttribute('stroke-opacity')).toBe('0.55');

      // Raw GPS mode switches accent to blue (#155b9d).
      await render({
        overlay: { ...overlay, corridorMatched: false, trackingMode: 'raw' },
        heading,
        width: 1000,
        height: 1000,
      });
      expect(host.querySelector('.device-heading-arc')?.getAttribute('stroke')).toBe('#155b9d');
      expect(host.querySelector('.device-position circle')?.getAttribute('fill')).toBe('#155b9d');

      // Zero-radius overlay falls back cleanly to minimum cone radius so the SVG arc stays valid.
      await render({
        overlay: { ...overlay, radiusX: 0, radiusY: 0 },
        heading,
        width: 1000,
        height: 1000,
      });
      expect(host.querySelector('.device-heading-cone')?.getAttribute('d')).toContain(
        'A 22 22 0 0 1',
      );

      // Missing or out-of-range heading omits sector/rays/arc and restores full ellipse stroke.
      for (const invalid of [null, { ...heading, spreadDeg: 0 }, { ...heading, spreadDeg: 180 }]) {
        await render({ overlay, heading: invalid, width: 1000, height: 1000 });
        expect(host.querySelector('.device-heading-cone')).toBeNull();
        expect(host.querySelector('.device-heading-rays')).toBeNull();
        expect(host.querySelector('.device-heading-arc')).toBeNull();
        expect(
          host.querySelector('.device-position ellipse')?.getAttribute('stroke-opacity'),
        ).toBeNull();
      }
    } finally {
      await act(async () => root.unmount());
    }
  });
});
