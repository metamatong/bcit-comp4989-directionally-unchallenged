/** Geometry and source-provenance regressions using official records and mocked readings. */
import { describe, expect, it } from 'vitest';
import { locationCatalogue } from '../server/geolocation';
import { visualPlans } from '../server/visual-data';
import {
  deviceOverlay,
  fitCalibration,
  overlapsBounds,
  overlapsFootprint,
} from '../src/location/geometry';
import { comparePhotoLocation } from '../src/location/photo-comparison';
import { eligibleReading } from '../src/location/browser-location';
import type { CampusLocationCandidate } from '../src/types';
import type { DeviceReading } from '../src/location/types';

const catalogue = locationCatalogue();
const plan = visualPlans.find((p) => p.id === 'SE12-F3-p1')!;
const calibration = catalogue.floors.find((f) => f.planId === plan.id)!;
const reading: DeviceReading = {
  ...calibration.controls[0],
  accuracy: 5,
  timestamp: 1000,
  receivedAt: 1000,
};

describe('source-grounded device location', () => {
  it('covers all supplied floors with hash-bound availability and archived official footprints', () => {
    expect(catalogue.floors).toHaveLength(visualPlans.length);
    expect(catalogue.buildings).toHaveLength(43);
    expect(catalogue.buildings.some((b) => b.building === 'NE25')).toBe(true);
    for (const floor of catalogue.floors) {
      expect(floor.sourceSha256).toBe(visualPlans.find((p) => p.id === floor.planId)?.sourceSha256);
      expect(floor.reason.length).toBeGreaterThan(20);
    }
    expect(catalogue.floors.find((floor) => floor.planId === 'SW3-F3-p1')?.status).toBe(
      'approximate',
    );
    expect(catalogue.floors.find((floor) => floor.planId === 'NW7-F1-p1')?.status).toBe(
      'unavailable',
    );
  });
  it('undoes prototype crop/resize and preserves pixel aspect ratio through normalization', () => {
    expect(calibration.controls[0].x).toBeCloseTo((200 + (115 * 3600) / 2800) / 4000, 12);
    expect(calibration.controls[0].y).toBeCloseTo(
      (660 + (704 * 1140) / 887) / ((4000 * 792) / 1224),
      12,
    );
    expect(calibration.heldOutMetres).toBeCloseTo(1.06, 1);
    const overlay = deviceOverlay(reading, plan, calibration)!;
    expect(overlay.radiusX * plan.width).toBeCloseTo(overlay.radiusY * plan.height, 12);
    const fit = fitCalibration(calibration.controls, plan.width, plan.height);
    for (const control of calibration.controls) {
      const p = fit.project(control);
      expect(
        Math.hypot((p.x - control.x) * plan.width, (p.y - control.y) * plan.height) / fit.scale,
      ).toBeLessThan(1.2);
    }
  });
  it('refuses stale sources and unresolved floor alignment', () => {
    expect(deviceOverlay(reading, plan, { ...calibration, sourceSha256: 'changed' })).toBeNull();
    expect(deviceOverlay(reading, plan, { ...calibration, status: 'unavailable' })).toBeNull();
    const controls = calibration.controls.map((c) => ({ ...c, latitude: 49, longitude: -123 }));
    expect(() => fitCalibration(controls, plan.width, plan.height)).toThrow('collinear');
  });
  it('checks acquisition freshness without discarding valid historical photo evidence', () => {
    expect(eligibleReading(reading)).toBe(true);
    expect(eligibleReading(reading, 3000)).toBe(true);
    expect(eligibleReading(reading, 3001)).toBe(false);
    for (const change of [
      { accuracy: -1 },
      { latitude: 91 },
      { longitude: NaN },
      { timestamp: 1001 },
    ])
      expect(eligibleReading({ ...reading, ...change })).toBe(false);
  });
  it('compares reported uncertainty with camera regions without mutating hypotheses', () => {
    const point = deviceOverlay(reading, plan, calibration)!.point;
    const candidate = {
      planId: plan.id,
      bounds: [point.x - 0.01, point.y - 0.01, point.x + 0.01, point.y + 0.01],
    } as CampusLocationCandidate;
    const before = structuredClone(candidate);
    expect(comparePhotoLocation(candidate, plan, reading, catalogue).message).toContain(
      'overlaps this possible photo region',
    );
    expect(
      comparePhotoLocation({ ...candidate, bounds: [0, 0, 0.001, 0.001] }, plan, reading, catalogue)
        .message,
    ).toContain('disagree');
    expect(candidate).toEqual(before);
    expect(overlapsBounds({ point: { x: 0, y: 0 }, radiusX: 0, radiusY: 0 }, [0, 0, 1, 1])).toBe(
      true,
    );
  });
  it('keeps building overlap identical across unresolved floors and handles footprint holes', () => {
    const floors = catalogue.floors.filter((f) => f.planId.startsWith('SW3-'));
    const building = catalogue.buildings.find((b) => b.building === 'SW3')!;
    const [longitude, latitude] = building.rings[0][0];
    const fix = { ...reading, longitude, latitude, accuracy: 20 };
    const messages = floors.map((f) => {
      const floorPlan = visualPlans.find((p) => p.id === f.planId)!;
      return comparePhotoLocation(
        { bounds: [0, 0, 1, 1] } as CampusLocationCandidate,
        floorPlan,
        fix,
        catalogue,
      ).message;
    });
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toContain('photo provides the floor and room evidence');
    const rings = [
      [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0.01],
        [0, 0],
      ],
      [
        [0.004, 0.004],
        [0.006, 0.004],
        [0.006, 0.006],
        [0.004, 0.006],
        [0.004, 0.004],
      ],
    ];
    expect(
      overlapsFootprint({ ...reading, longitude: 0.005, latitude: 0.005, accuracy: 1 }, rings),
    ).toBe(false);
    expect(
      overlapsFootprint({ ...reading, longitude: 0.002, latitude: 0.005, accuracy: 1 }, rings),
    ).toBe(true);
  });
});
