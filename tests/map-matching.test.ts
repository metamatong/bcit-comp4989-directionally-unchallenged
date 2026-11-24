// @vitest-environment jsdom
/** Focused unit & DOM checks for client-side indoor GPS corridor map-matching. */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { floorGraphs } from '../server/floor-graph';
import { locationCatalogue } from '../server/geolocation';
import { pilotEvidence } from '../server/pilot-evidence';
import { visualPlans } from '../server/visual-data';
import { RouteDirections } from '../src/components/RouteDirections';
import { fitCalibration, overlapsFootprint } from '../src/location/geometry';
import { MAP_MATCH_CONFIG, matchDeviceToFloor } from '../src/location/map-matching';
import type { DeviceReading } from '../src/location/types';
import type { MapStop, NavigationResult, WalkingSurface } from '../src/wayfinding';
import { walkingRouteFixture } from './wayfinding-fixtures';

const catalogue = locationCatalogue();
const se12Plan = visualPlans.find((plan) => plan.id === 'SE12-F3-p1')!;
const se12Calibration = catalogue.floors.find((floor) => floor.planId === se12Plan.id)!;
const se12BuildingRings = catalogue.buildings.find((building) => building.building === 'SE12')!.rings;
const se12Fit = fitCalibration(se12Calibration.controls, se12Plan.width, se12Plan.height);
const se12Floor = floorGraphs().byId.get(se12Plan.id)!;
const se12Surface: WalkingSurface = {
  planId: se12Floor.plan.id,
  sourceSha256: se12Floor.plan.sourceSha256,
  graphVersion: se12Floor.version,
  step: se12Floor.step,
  runs: se12Floor.runs,
};

const se12Controls = se12Calibration.controls.map((control) => se12Fit.project(control));
const se12TopY = Math.min(...se12Controls.map((point) => point.y));
const se12MidX =
  (Math.min(...se12Controls.map((point) => point.x)) +
    Math.max(...se12Controls.map((point) => point.x))) /
  2;

function se12ExteriorPoint(metresOut: number) {
  return { x: se12MidX, y: se12TopY - (metresOut * se12Fit.scale) / se12Plan.height };
}

function readingAt(point: { x: number; y: number }, accuracy = 6, timestamp = 10_000): DeviceReading {
  return { ...se12Fit.unproject(point), accuracy, timestamp, receivedAt: timestamp };
}

afterEach(() => vi.unstubAllGlobals());

describe('indoor corridor map-matching', () => {
  it('preserves the original near-wall snap allowance when the fix misses the building', () => {
    const reading = readingAt(se12ExteriorPoint(10), 6);
    expect(overlapsFootprint(reading, se12BuildingRings)).toBe(false);
    const result = matchDeviceToFloor({
      reading,
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      buildingRings: se12BuildingRings,
      stepKind: 'corridor',
    });

    expect(result.status).toBe('matched');
    if (result.status !== 'matched') return;
    expect(result.overlay.snapDistanceMetres).toBeGreaterThan(9);
    expect(result.overlay.snapDistanceMetres).toBeLessThanOrEqual(
      MAP_MATCH_CONFIG.minSnapWithoutFootprintOverlapMetres,
    );
    expect(result.overlay.point.y).toBeGreaterThan(se12TopY);
    expect((result.overlay.radiusY * se12Plan.height) / se12Fit.scale).toBeCloseTo(
      result.overlay.snapDistanceMetres!,
      4,
    );

    const exteriorReading = readingAt(se12ExteriorPoint(15), 6);
    expect(overlapsFootprint(exteriorReading, se12BuildingRings)).toBe(false);
    expect(
      matchDeviceToFloor({
        reading: exteriorReading,
        plan: se12Plan,
        calibration: se12Calibration,
        surface: se12Surface,
        buildingRings: se12BuildingRings,
        stepKind: 'corridor',
      }).status,
    ).toBe('too-far');
  });

  it('applies the 24 m cap when the accuracy circle overlaps SE12', () => {
    const context = { plan: se12Plan, calibration: se12Calibration, surface: se12Surface };
    // This transect reaches the corridor about 0.34 m past the alignment control.
    const insideCap = readingAt(se12ExteriorPoint(22.66), 30);
    const outsideCap = readingAt(se12ExteriorPoint(24.66), 30);
    expect(overlapsFootprint(insideCap, se12BuildingRings)).toBe(true);
    expect(overlapsFootprint(outsideCap, se12BuildingRings)).toBe(true);
    const result = matchDeviceToFloor({
      ...context,
      reading: insideCap,
      buildingRings: se12BuildingRings,
    });
    expect(result.status).toBe('matched');
    if (result.status === 'matched') expect(result.rawOffsetMetres).toBeCloseTo(23, 1);
    expect(
      matchDeviceToFloor({ ...context, reading: outsideCap, buildingRings: se12BuildingRings }).status,
    ).toBe('too-far');
    expect(matchDeviceToFloor({ ...context, reading: insideCap }).status).toBe('too-far');
  });

  it('rejects extreme outliers, wide accuracy circles, and mismatched surface hashes', () => {
    expect(
      matchDeviceToFloor({
        reading: readingAt(se12ExteriorPoint(28), 18),
        plan: se12Plan,
        calibration: se12Calibration,
        surface: se12Surface,
      }).status,
    ).toBe('too-far');

    expect(
      matchDeviceToFloor({
        reading: readingAt(se12Controls[0], 45),
        plan: se12Plan,
        calibration: se12Calibration,
        surface: se12Surface,
      }).status,
    ).toBe('low-accuracy');

    expect(
      matchDeviceToFloor({
        reading: readingAt(se12Controls[0], 5),
        plan: se12Plan,
        calibration: se12Calibration,
        surface: { ...se12Surface, sourceSha256: '0'.repeat(64) },
      }).status,
    ).toBe('unavailable');
  });

  it('holds the current corridor against a sudden noisy jump, yet follows a real detour', () => {
    // Two parallel corridors separated by 8 m in Y on SE12 scale.
    const step = 10;
    const rowA = Math.round((0.4 * se12Plan.height) / step);
    const rowB = Math.round((0.4 * se12Plan.height + 8 * se12Fit.scale) / step);
    const colStart = Math.round((0.3 * se12Plan.width) / step);
    const colEnd = Math.round((0.7 * se12Plan.width) / step);
    const twoCorridors: WalkingSurface = {
      planId: se12Plan.id,
      sourceSha256: se12Plan.sourceSha256,
      graphVersion: 'synthetic',
      step,
      runs: [
        [rowA, colStart, colEnd],
        [rowB, colStart, colEnd],
      ],
    };

    const midX = (((colStart + colEnd) / 2) * step) / se12Plan.width;
    const yA = ((rowA + 0.5) * step) / se12Plan.height;
    const yB = ((rowB + 0.5) * step) / se12Plan.height;

    // 1 s later, noisy fix drifts 4.5 m toward corridor B (slightly closer to B than A).
    const held = matchDeviceToFloor({
      reading: readingAt({ x: midX, y: yA + (4.5 * se12Fit.scale) / se12Plan.height }, 8, 11_000),
      plan: se12Plan,
      calibration: se12Calibration,
      surface: twoCorridors,
      previous: { point: { x: midX, y: yA }, timestamp: 10_000 },
    });
    expect(held.status).toBe('matched');
    if (held.status === 'matched') {
      expect(Math.abs(held.overlay.point.y - yA)).toBeLessThan(Math.abs(held.overlay.point.y - yB));
    }

    // 8 s later, visitor genuinely walked over to corridor B.
    const detour = matchDeviceToFloor({
      reading: readingAt({ x: midX, y: yB }, 8, 18_000),
      plan: se12Plan,
      calibration: se12Calibration,
      surface: twoCorridors,
      previous: { point: { x: midX, y: yA }, timestamp: 10_000 },
    });
    expect(detour.status).toBe('matched');
    if (detour.status === 'matched') {
      expect(Math.abs(detour.overlay.point.y - yB)).toBeLessThan(
        Math.abs(detour.overlay.point.y - yA),
      );
    }
  });

  it('exempts outdoor transfer steps from indoor corridor snapping', () => {
    const result = matchDeviceToFloor({
      reading: readingAt(se12Controls[0], 6),
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      stepKind: 'outdoor',
    });
    expect(result.status).toBe('raw');
    if (result.status === 'raw') expect(result.overlay.snapDistanceMetres).toBeUndefined();
  });

  it('reports the displayed halo radius without shifting the route viewBox', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    let reportLocation: PositionCallback = () => {};
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: vi.fn((success: PositionCallback) => {
          reportLocation = success;
          return 7;
        }),
        clearWatch: vi.fn(),
      },
    });

    const fixture = walkingRouteFixture();
    const stop = (point: Omit<MapStop, 'id'>): MapStop => ({
      ...point,
      id: `${point.planId}:${point.label}`,
    });
    const route: Extract<NavigationResult, { status: 'route' }> = {
      status: 'route',
      networkRevision: 1,
      origins: [],
      destinations: [],
      origin: stop(fixture.origin),
      destination: stop(fixture.destination),
      steps: fixture.steps.map((s) => ({ ...s, from: stop(s.from), to: stop(s.to) })),
    };
    // Isolate one corridor cell so the nearest point is exactly 15.3 m from the simulated fix.
    const surface: WalkingSurface = { ...se12Surface, runs: [[133, 200, 200]] };
    const reading = readingAt({
      x: (201 * surface.step + 15.3 * se12Fit.scale) / se12Plan.width,
      y: (133.5 * surface.step) / se12Plan.height,
    });
    expect(overlapsFootprint(reading, se12BuildingRings)).toBe(true);

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
            walkingSurfaces: { [se12Plan.id]: surface },
            onRecheck: vi.fn(),
          }),
        ),
      );

      const initialViewBox = host.querySelector('.walking-map')?.getAttribute('viewBox');
      expect(initialViewBox).toBeTruthy();

      await act(async () =>
        reportLocation({
          coords: {
            latitude: reading.latitude,
            longitude: reading.longitude,
            accuracy: reading.accuracy,
          },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );

      expect(host.querySelector('.walking-map')?.getAttribute('viewBox')).toBe(initialViewBox);
      expect(host.querySelector('.device-position')?.getAttribute('data-matched')).toBe('true');
      const radiusX = host.querySelector('.device-position ellipse')?.getAttribute('rx');
      expect(Number(radiusX) / se12Fit.scale).toBeCloseTo(15.3, 4);
      expect(host.querySelector('.guided-location-status [role="status"]')?.textContent).toBe(
        'Approx. location',
      );
      expect(host.querySelector('.guided-location-status')?.textContent).toContain(
        'Approx. location · 16 m uncertainty radius',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
