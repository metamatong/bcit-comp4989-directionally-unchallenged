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
import { BrowserHeading } from '../src/location/browser-heading';
import { resetMotionPermissionCacheForTests } from '../src/location/browser-motion';
import { fitCalibration } from '../src/location/geometry';
import {
  extractMagneticBearingRad,
  HEADING_CONFIG,
  HeadingEstimator,
  wrapAngleRad,
} from '../src/location/heading';
import type { CalibrationControl } from '../src/location/types';
import { useHeadingTracker } from '../src/location/use-heading-tracker';
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
    for (const webkitCompassAccuracy of [-1, 60, NaN]) {
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
        .mockResolvedValue('granted');
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
          host
            .querySelector('.guided-map')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(requestMotion).toHaveBeenCalledTimes(1);
        expect(requestOrientation).toHaveBeenCalledTimes(permission === 'granted' ? 1 : 0);

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
      act(async () => root.render(createElement('svg', null, createElement(DevicePosition, props))));

    try {
      // Corridor-matched with active heading: sector and arc match full rx/ry (50, 80).
      await render({ overlay, heading, width: 1000, height: 1000 });
      const cone = host.querySelector('.device-heading-cone');
      const rays = host.querySelector('.device-heading-rays');
      const arc = host.querySelector('.device-heading-arc');
      const ellipse = host.querySelector('.device-position ellipse');
      expect(cone?.getAttribute('d')).toContain('A 50 80 0 0 1');
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
        expect(host.querySelector('.device-position ellipse')?.getAttribute('stroke-opacity')).toBeNull();
      }
    } finally {
      await act(async () => root.unmount());
    }
  });
});
