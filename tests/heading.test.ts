// @vitest-environment jsdom
/**
 * Focused unit and DOM tests for the live directional heading cone:
 * - True North -> floor-plan pixel angle conversion (including rotated plans)
 * - iOS webkitCompassHeading & Android 3D tilt-compensated deviceorientationabsolute
 * - Complementary gyro + compass smoothing, magnetic-spike damping, and staleness expiry
 * - Stage 2 PDR travel-heading fallback and stationary gyro rotation
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
import { resetMotionPermissionCacheForTests } from '../src/location/browser-motion';
import { fitCalibration } from '../src/location/geometry';
import {
  extractMagneticBearingRad,
  HEADING_CONFIG,
  HeadingEstimator,
  wrapAngleRad,
} from '../src/location/heading';
import type { CalibrationControl } from '../src/location/types';
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
    expect(Math.abs(wrapAngleRad(northUpFit.bearingToPlanAngle(0) - -Math.PI / 2))).toBeLessThan(0.01);
    expect(Math.abs(wrapAngleRad(northUpFit.bearingToPlanAngle(Math.PI / 2) - 0))).toBeLessThan(0.01);

    // 90 deg clockwise-rotated plan: +North -> +X right, +East -> +Y down.
    const rotatedControls: CalibrationControl[] = [
      { label: 'O', latitude: lat0, longitude: lon0, x: 0.5, y: 0.5 },
      { label: 'E', latitude: lat0, longitude: lon0 + dLon, x: 0.5, y: 0.6 },
      { label: 'N', latitude: lat0 + dLat, longitude: lon0, x: 0.6, y: 0.5 },
      { label: 'NE', latitude: lat0 + dLat, longitude: lon0 + dLon, x: 0.6, y: 0.6 },
    ];
    const rotatedFit = fitCalibration(rotatedControls, 1000, 1000);
    expect(Math.abs(wrapAngleRad(rotatedFit.bearingToPlanAngle(0) - 0))).toBeLessThan(0.01);
    expect(Math.abs(wrapAngleRad(rotatedFit.bearingToPlanAngle(Math.PI / 2) - Math.PI / 2))).toBeLessThan(0.01);

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
    expect(Math.abs(wrapAngleRad(se12Fit.bearingToPlanAngle(0) - expectedNorthAngle))).toBeLessThan(0.005);
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
      timestamp: 1000,
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
      timestamp: 1000,
    });
    expect(Math.abs(wrapAngleRad(landscape!.bearingRad - 0))).toBeLessThan(1e-6);

    // Reject uncalibrated (-1) or overly wide (> 45 deg) compass accuracy.
    expect(
      extractMagneticBearingRad({
        alpha: 0,
        beta: 0,
        gamma: 0,
        absolute: false,
        webkitCompassHeading: 45,
        webkitCompassAccuracy: -1,
        screenAngleDeg: 0,
        timestamp: 1000,
      }),
    ).toBeNull();
    expect(
      extractMagneticBearingRad({
        alpha: 0,
        beta: 0,
        gamma: 0,
        absolute: false,
        webkitCompassHeading: 45,
        webkitCompassAccuracy: 60,
        screenAngleDeg: 0,
        timestamp: 1000,
      }),
    ).toBeNull();
  });

  it('computes consistent Android absolute bearings across flat, 45 deg, upright, rolled, and landscape holds', () => {
    // Reject non-absolute W3C orientation events (relative alpha is not North-referenced).
    expect(
      extractMagneticBearingRad({
        alpha: 270,
        beta: 0,
        gamma: 0,
        absolute: false,
        screenAngleDeg: 0,
        timestamp: 1000,
      }),
    ).toBeNull();

    // Facing East (90 deg magnetic) across flat (beta=0), 45 deg tilt, and upright portrait (beta=90).
    for (const beta of [0, 35, 45, 65, 90]) {
      const sample = extractMagneticBearingRad({
        alpha: 270,
        beta,
        gamma: 0,
        absolute: true,
        screenAngleDeg: 0,
        timestamp: 1000,
      });
      expect(sample).not.toBeNull();
      expect(Math.abs(wrapAngleRad(sample!.bearingRad - Math.PI / 2))).toBeLessThan(1e-4);
    }

    // Upright portrait facing North (alpha=0, beta=90) rolled +15 deg around Y turns back (-Z) 15 deg West (345 deg).
    const rolled = extractMagneticBearingRad({
      alpha: 0,
      beta: 90,
      gamma: 15,
      absolute: true,
      screenAngleDeg: 0,
      timestamp: 1000,
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
      timestamp: 1000,
    });
    expect(landscapeFlat).not.toBeNull();
    expect(Math.abs(wrapAngleRad(landscapeFlat!.bearingRad - 0))).toBeLessThan(1e-4);
  });
});

describe('HeadingEstimator complementary filter, spike damping, and PDR fallback', () => {
  const northUpTransform = (trueBearingRad: number) => wrapAngleRad(trueBearingRad - Math.PI / 2);

  it('applies BCIT magnetic declination, rotates smoothly with gyro yaw, and damps sudden magnetic spikes', () => {
    const estimator = new HeadingEstimator();
    // Initial iOS compass facing Magnetic North (0 deg) -> True bearing = +15.3 deg.
    estimator.ingestGyroYaw(0, 1000);
    estimator.ingestOrientation({
      alpha: null,
      beta: null,
      gamma: null,
      absolute: false,
      webkitCompassHeading: 0,
      webkitCompassAccuracy: 15,
      screenAngleDeg: 0,
      timestamp: 1000,
    });
    const initial = estimator.resolvePlanHeading(northUpTransform, null, 1000)!;
    expect(initial.source).toBe('compass-gyro');
    expect(initial.spreadDeg).toBe(50);
    expect(
      Math.abs(wrapAngleRad(initial.angleRad - northUpTransform(HEADING_CONFIG.bcitDeclinationDeg * DEG))),
    ).toBeLessThan(0.01);

    // Sudden 90 deg magnetic spike for 0.4 s while stationary (gyro = 0): damped strongly (< 10 deg pull).
    for (let t = 1100; t <= 1400; t += 100) {
      estimator.ingestGyroYaw(0, t);
      estimator.ingestOrientation({
        alpha: null,
        beta: null,
        gamma: null,
        absolute: false,
        webkitCompassHeading: 90,
        webkitCompassAccuracy: 15,
        screenAngleDeg: 0,
        timestamp: t,
      });
    }
    const afterSpike = estimator.resolvePlanHeading(northUpTransform, null, 1400)!;
    expect(Math.abs(wrapAngleRad(afterSpike.angleRad - initial.angleRad))).toBeLessThan(10 * DEG);

    // Real 90 deg left turn (CCW = +pi/2 rad over 1 s) via gyro rotates floor-plan angle by -pi/2.
    for (let t = 1500; t <= 2400; t += 100) {
      estimator.ingestGyroYaw(Math.PI / 2, t);
    }
    const afterTurn = estimator.resolvePlanHeading(northUpTransform, null, 2400)!;
    expect(Math.abs(wrapAngleRad(afterTurn.angleRad - (initial.angleRad - Math.PI / 2)))).toBeLessThan(
      15 * DEG,
    );

    // Past compassStaleMs without orientation updates -> expires cleanly to null.
    expect(estimator.resolvePlanHeading(northUpTransform, null, 1400 + HEADING_CONFIG.compassStaleMs + 1)).toBeNull();
  });

  it('falls back to resolved Stage 2 PDR heading when compass is unavailable and rotates via gyro while stationary', () => {
    const estimator = new HeadingEstimator();
    estimator.ingestGyroYaw(0, 1000);
    const pdrHeading = estimator.resolvePlanHeading(
      northUpTransform,
      { angleRad: 0.2, resultant: 0.9 },
      1000,
    )!;
    expect(pdrHeading).toEqual({ angleRad: 0.2, spreadDeg: 50, source: 'pdr' });

    // User stops (no active pdrFallback passed) and pivots 90 deg left with live gyro.
    for (let t = 1100; t <= 2000; t += 100) {
      estimator.ingestGyroYaw(Math.PI / 2, t);
    }
    const rotated = estimator.resolvePlanHeading(northUpTransform, null, 2000)!;
    expect(rotated.source).toBe('pdr');
    expect(Math.abs(wrapAngleRad(rotated.angleRad - (0.2 - Math.PI / 2)))).toBeLessThan(0.05);
  });
});

describe('GuidedDirections heading cone DOM integration', () => {
  it('renders a directional cone layered over the uncertainty circle while standing still, omits it on last-known fallback, and prompts on iOS map tap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

    const requestMotion = vi.fn<() => Promise<'granted' | 'denied'>>().mockResolvedValue('granted');
    const requestOrientation = vi.fn<() => Promise<'granted' | 'denied'>>().mockResolvedValue('granted');
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

      // Before iOS Motion & Orientation permission is granted, dot + circle render with no cone.
      expect(host.querySelector('.device-position ellipse')).not.toBeNull();
      expect(host.querySelector('.device-position circle')).not.toBeNull();
      expect(host.querySelector('.device-heading-cone')).toBeNull();

      // Tapping the map area on Step 1 unlocks both Motion & Orientation on iOS.
      await act(async () => {
        host.querySelector('.guided-map')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(requestMotion).toHaveBeenCalledTimes(1);
      expect(requestOrientation).toHaveBeenCalledTimes(1);

      // Dispatch an iOS compass event while standing still -> cone appears over the uncertainty ellipse.
      const orient1 = new Event('deviceorientation');
      Object.assign(orient1, { webkitCompassHeading: 0, webkitCompassAccuracy: 15 });
      await act(async () => {
        window.dispatchEvent(orient1);
      });

      const cone1 = host.querySelector('.device-heading-cone');
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

      // Past GPS hold expiry (> 8 s), hollow last-known marker appears with NO heading cone.
      await act(async () => vi.advanceTimersByTime(9_000));
      expect(host.querySelector('.last-known-position')).not.toBeNull();
      expect(host.querySelector('.device-heading-cone')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
