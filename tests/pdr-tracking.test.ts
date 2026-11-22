// @vitest-environment jsdom
/**
 * Unit, DOM lifecycle, and three-way comparative simulation tests for corridor PDR + GPS fusion
 * over verified SE12-F3-p1 and SW3-F3-p1 walking surfaces.
 * Note: These offline tests use deterministic synthetic trajectories and do not substitute for
 * physical-campus Android Chrome and iOS Safari field validation.
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
import { matchDeviceToFloor, type PreviousMatch } from '../src/location/map-matching';
import { IndoorPdrTracker, PDR_TRACKER_CONFIG } from '../src/location/pdr-tracker';
import type {
  DetectedStep,
  DeviceReading,
  MotionActivityState,
  MotionSnapshot,
} from '../src/location/types';
import { WalkableGrid } from '../src/location/walkable-grid';
import type { MapStop, NavigationResult, PagePoint, WalkingSurface } from '../src/wayfinding';
import { walkingRouteFixture } from './wayfinding-fixtures';

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

const sw3Plan = visualPlans.find((plan) => plan.id === 'SW3-F3-p1')!;
const sw3Calibration = catalogue.floors.find((floor) => floor.planId === sw3Plan.id)!;
const sw3Fit = fitCalibration(sw3Calibration.controls, sw3Plan.width, sw3Plan.height);
const sw3Floor = floorGraphs().byId.get(sw3Plan.id)!;
const sw3Surface: WalkingSurface = {
  planId: sw3Floor.plan.id,
  sourceSha256: sw3Floor.plan.sourceSha256,
  graphVersion: sw3Floor.version,
  step: sw3Floor.step,
  runs: sw3Floor.runs,
};

function cellToPage(
  gx: number,
  gy: number,
  surface: WalkingSurface,
  plan: { width: number; height: number },
): PagePoint {
  return {
    x: ((gx + 0.5) * surface.step) / plan.width,
    y: ((gy + 0.5) * surface.step) / plan.height,
  };
}

function readingFromPage(
  point: PagePoint,
  fit: ReturnType<typeof fitCalibration>,
  accuracy: number,
  timestamp: number,
): DeviceReading {
  return {
    ...fit.unproject(point),
    accuracy,
    timestamp,
    receivedAt: timestamp,
  };
}

function distMetres(
  a: PagePoint,
  b: PagePoint,
  plan: { width: number; height: number },
  scale: number,
): number {
  return Math.hypot((a.x - b.x) * plan.width, (a.y - b.y) * plan.height) / scale;
}

function makeMotionSnapshot(
  activity: MotionActivityState,
  overrides: Partial<MotionSnapshot> = {},
): MotionSnapshot {
  return {
    supported: true,
    permission: 'granted',
    active: true,
    hasAccel: true,
    hasGyro: true,
    gyroFresh: overrides.hasGyro ?? true,
    gyroFreshSince: overrides.hasGyro === false ? null : 0,
    activity,
    stepCount: 0,
    estimatedDistanceMetres: 0,
    lastStepAt: null,
    lastEventAt: 10_000,
    ...overrides,
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p90(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
}

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

function dispatchDeviceMotion(
  acc: { x: number; y: number; z: number },
  rot: { alpha: number | null; beta: number | null; gamma: number | null } = {
    alpha: null,
    beta: null,
    gamma: null,
  },
) {
  const event = new Event('devicemotion') as DeviceMotionEvent;
  Object.defineProperty(event, 'accelerationIncludingGravity', { value: acc });
  Object.defineProperty(event, 'rotationRate', { value: rot });
  window.dispatchEvent(event);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetMotionPermissionCacheForTests();
});

describe('WalkableGrid strict FloorGraph.neighbours connectivity', () => {
  it('blocks crossing a 1-cell thin partition wall and diagonal corner-cutting, while allowing a real doorway opening', () => {
    // Two parallel corridors separated by a 1-cell wall at gy=10, with a 2-cell doorway at gx=20..21.
    const surface: WalkingSurface = {
      planId: 'synthetic-wall',
      sourceSha256: '0'.repeat(64),
      graphVersion: '1',
      step: 2,
      runs: [
        [8, 5, 30],
        [9, 5, 30],
        [10, 20, 21], // Legitimate doorway opening only at gx=20..21
        [11, 5, 30],
        [12, 5, 30],
      ],
    };
    const grid = new WalkableGrid(surface, 100, 100);

    // Stepping straight South at gx=10 from gy=9 toward gy=11 must be blocked by the 1-cell wall.
    const startWall = { x: 10.5 * 2, y: 9.5 * 2 };
    const wallStep = grid.traceStep(startWall, Math.PI / 2, 4.0);
    expect(wallStep.outcome).toBe('blocked');
    expect(Math.floor(wallStep.pointPx.y / 2)).toBeLessThanOrEqual(9);

    // Resampling jitter across the 1-cell wall must also be rejected.
    expect(grid.jitterConnected(startWall, 0, 4.0)).toEqual(startWall);

    // Stepping South through the real doorway opening at gx=20 must succeed cleanly.
    const startDoor = { x: 20.5 * 2, y: 9.5 * 2 };
    const doorStep = grid.traceStep(startDoor, Math.PI / 2, 4.0);
    expect(doorStep.outcome).toBe('clear');
    expect(Math.floor(doorStep.pointPx.y / 2)).toBe(11);

    // Diagonal corner-cutting: two cells touching only at a corner with blocked orthogonal sides.
    const cornerSurface: WalkingSurface = {
      planId: 'synthetic-corner',
      sourceSha256: '0'.repeat(64),
      graphVersion: '1',
      step: 2,
      runs: [
        [5, 5, 5],
        [6, 6, 6],
      ],
    };
    const cornerGrid = new WalkableGrid(cornerSurface, 40, 40);
    expect(cornerGrid.canStepBetweenAdjacentCells(5, 5, 6, 6)).toBe(false);
    expect(
      cornerGrid.traceConnectedSegment({ x: 5.5 * 2, y: 5.5 * 2 }, { x: 6.5 * 2, y: 6.5 * 2 })
        .reached,
    ).toBe(false);
  });
});

describe('IndoorPdrTracker lifecycle, deduplication, ambiguity, and halo invariants', () => {
  it('deduplicates repeated GPS timestamps, holds 0 m stationary drift in Tier 2, releases after 3 unique divergent fixes, and drops to Tier 1 on sensor silence', () => {
    const tracker = new IndoorPdrTracker({ enableParticleFilter: false });
    const corridorPt = cellToPage(200, 133, se12Surface, se12Plan);
    tracker.configureContext({
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      stepKind: 'corridor',
      isSamePlanStep: true,
    });

    const stationary = makeMotionSnapshot('stationary', { hasGyro: false });
    // First fix establishes the corridor anchor.
    const first = tracker.ingestGpsReading(readingFromPage(corridorPt, se12Fit, 6, 10_000), stationary);
    expect(first.status).toBe('matched');
    if (first.status !== 'matched') return;
    const anchor = first.overlay.point;

    // 30 s of oscillating 9 m multipath pulls while stationary must hold 0.0 m drift.
    for (let i = 1; i <= 15; i++) {
      const pull = {
        x: corridorPt.x + ((i % 2 === 0 ? 7 : -7) * se12Fit.scale) / se12Plan.width,
        y: corridorPt.y - (9 * se12Fit.scale) / se12Plan.height,
      };
      const res = tracker.ingestGpsReading(
        readingFromPage(pull, se12Fit, 7, 10_000 + i * 2000),
        stationary,
      );
      expect(res.status).toBe('matched');
      if (res.status === 'matched') {
        expect(distMetres(res.overlay.point, anchor, se12Plan, se12Fit.scale)).toBeCloseTo(0, 6);
        expect(res.overlay.trackingMode).toBe('motion-gated');
      }
    }

    // Re-ingesting ONE single 18 m outlier 4 times with the SAME timestamp must NOT trip 3-fix recovery.
    const shiftedCorridor = cellToPage(290, 133, se12Surface, se12Plan); // ~19.6 m East
    const singleOutlier = readingFromPage(shiftedCorridor, se12Fit, 7, 50_000);
    for (let tick = 0; tick < 4; tick++) {
      const res = tracker.ingestGpsReading(singleOutlier, stationary);
      expect(res.status).toBe('matched');
      if (res.status === 'matched') {
        expect(distMetres(res.overlay.point, anchor, se12Plan, se12Fit.scale)).toBeCloseTo(0, 6);
      }
    }

    // Two more UNIQUE divergent timestamps (3 total) must release the stationary anchor.
    tracker.ingestGpsReading(readingFromPage(shiftedCorridor, se12Fit, 7, 51_000), stationary);
    const released = tracker.ingestGpsReading(
      readingFromPage(shiftedCorridor, se12Fit, 7, 52_000),
      stationary,
    );
    expect(released.status).toBe('matched');
    if (released.status === 'matched') {
      expect(distMetres(released.overlay.point, shiftedCorridor, se12Plan, se12Fit.scale)).toBeLessThan(1.5);
    }

    // Sensor silence ('unknown') drops immediately back to Tier 1 ('matched').
    const silent = makeMotionSnapshot('unknown', { hasGyro: false });
    const tier1 = tracker.ingestGpsReading(
      readingFromPage(cellToPage(300, 133, se12Surface, se12Plan), se12Fit, 6, 54_000),
      silent,
    );
    expect(tier1.status).toBe('matched');
    if (tier1.status === 'matched') {
      expect(tier1.overlay.trackingMode).toBe('matched');
    }
  });

  it.each([
    { name: 'alternating outliers', fixes: [[15, 7, 1000], [-15, 7, 1000], [15, 7, 1000]] },
    { name: 'a rejected fix', fixes: [[15, 7, 1000], [15, 7, 1000], [0, 50, 1000], [15, 7, 1000]] },
    { name: 'a return to the anchor', fixes: [[15, 7, 1000], [15, 7, 1000], [0, 7, 1000], [15, 7, 1000]] },
    { name: 'a long gap', fixes: [[15, 7, 1000], [15, 7, 1000], [15, 7, 10_001]] },
  ])('holds the stationary anchor through $name', ({ fixes }) => {
    const tracker = new IndoorPdrTracker();
    const point = cellToPage(200, 133, se12Surface, se12Plan);
    const motion = makeMotionSnapshot('stationary', { hasGyro: false });
    tracker.configureContext({
      plan: se12Plan, calibration: se12Calibration, surface: se12Surface,
      stepKind: 'corridor', isSamePlanStep: true,
    });
    let timestamp = 10_000;
    const first = tracker.ingestGpsReading(readingFromPage(point, se12Fit, 7, timestamp), motion);
    if (first.status !== 'matched') throw Error('Expected the initial corridor anchor');

    for (const [offsetMetres, accuracy, gap] of fixes) {
      timestamp += gap;
      const shifted = { ...point, x: point.x + offsetMetres * se12Fit.scale / se12Plan.width };
      const result = tracker.ingestGpsReading(readingFromPage(shifted, se12Fit, accuracy, timestamp), motion);
      if (accuracy > 35) {
        expect(result.status).toBe('low-accuracy');
      } else {
        expect(result).toMatchObject({ status: 'matched', overlay: { point: first.overlay.point } });
      }
    }
  });

  it.each(['time', 'steps'])('expires a resolved bridge at the %s limit', (limit) => {
    const tracker = new IndoorPdrTracker({ enableParticleFilter: true, seed: 42 });
    const startPt = cellToPage(160, 133, se12Surface, se12Plan);
    tracker.configureContext({
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      stepKind: 'corridor',
      isSamePlanStep: true,
    });

    const moving = makeMotionSnapshot('moving');
    // Fix 1 alone in a straight hallway has 180 deg ambiguity -> bridging must be suppressed initially!
    const initial = tracker.ingestGpsReading(readingFromPage(startPt, se12Fit, 8, 10_000), moving);
    expect(initial.status).toBe('matched');
    if (initial.status === 'matched') {
      expect(initial.directionResolved).toBe(false);
    }
    expect(tracker.evaluateAt(12_500, false, 'moving').status).toBe('waiting');

    // Walk East (~15 m) with confirming GPS fixes so direction resolves cleanly beyond 10 m GPS noise.
    let t = 10_000;
    for (let k = 0; k < 7; k++) {
      const truth = { x: startPt.x + (k * 2.1 * se12Fit.scale) / se12Plan.width, y: startPt.y };
      if (k > 0) tracker.ingestGpsReading(readingFromPage(truth, se12Fit, 8, t), moving);
      for (let s = 0; s < 3; s++) {
        t += 550;
        tracker.ingestStep({
          stepIndex: k * 3 + s + 1,
          stepLengthMetres: 0.7,
          deltaYawRad: 0,
          hasGyro: true,
          turnNoiseRad: 0,
          timestamp: t,
        });
      }
      t += 350;
    }

    const lastGpsT = t;
    const finalTruth = { x: startPt.x + (15 * se12Fit.scale) / se12Plan.width, y: startPt.y };
    const anchored = tracker.ingestGpsReading({
      ...readingFromPage(finalTruth, se12Fit, 8, lastGpsT),
      receivedAt: lastGpsT + 800,
    }, moving);
    expect(anchored.status).toBe('matched');
    if (anchored.status !== 'matched') return;
    const baseRadiusPx = anchored.overlay.radiusX * se12Plan.width;

    // Take a step during a GPS dropout and check that the halo grows from the anchor.
    tracker.ingestStep({
      stepIndex: 100,
      stepLengthMetres: 0.7,
      deltaYawRad: 0,
      hasGyro: true,
      turnNoiseRad: 0,
      timestamp: lastGpsT + 3000,
    });
    const bridged1 = tracker.evaluateAt(lastGpsT + 3500, false, 'moving');
    expect(bridged1.status).toBe('bridged');
    if (bridged1.status !== 'bridged') return;
    const r1Px = bridged1.overlay.radiusX * se12Plan.width;
    expect(r1Px).toBeGreaterThan(baseRadiusPx + 0.3 * se12Fit.scale);

    const rejected = tracker.ingestGpsReading(
      readingFromPage(finalTruth, se12Fit, 50, lastGpsT + 4000),
      moving,
    );
    expect(rejected.status).toBe('low-accuracy');

    if (limit === 'steps') {
      for (let stepIndex = 2; stepIndex <= PDR_TRACKER_CONFIG.maxBridgeSteps; stepIndex++) {
        const timestamp = lastGpsT + 3000 + (stepIndex - 1) * 550;
        expect(tracker.ingestStep({
          stepIndex: 99 + stepIndex, stepLengthMetres: 0.7, deltaYawRad: 0,
          hasGyro: true, turnNoiseRad: 0, timestamp,
        })).toBe(true);
        const expected = stepIndex < PDR_TRACKER_CONFIG.maxBridgeSteps ? 'bridged' : 'waiting';
        expect(tracker.evaluateAt(timestamp, false, 'moving').status).toBe(expected);
      }
      return;
    }

    // Even with zero additional steps, the radius grows and the deadline uses capture time.
    const bridged2 = tracker.evaluateAt(lastGpsT + 10_000, false, 'moving');
    expect(bridged2.status).toBe('bridged');
    if (bridged2.status === 'bridged') {
      expect(bridged2.overlay.radiusX * se12Plan.width).toBeGreaterThan(r1Px);
    }
    const deadline = lastGpsT + PDR_TRACKER_CONFIG.maxBridgeMs;
    expect(tracker.evaluateAt(deadline - 1, false, 'moving').status).toBe('bridged');
    expect(tracker.evaluateAt(deadline, false, 'moving').status).toBe('waiting');
  });

  it('falls back on gyro loss and re-anchors only with a fix captured after recovery', () => {
    const tracker = new IndoorPdrTracker({ enableParticleFilter: true, seed: 42 });
    const point = cellToPage(160, 133, se12Surface, se12Plan);
    tracker.configureContext({
      plan: se12Plan, calibration: se12Calibration, surface: se12Surface,
      stepKind: 'corridor', isSamePlanStep: true,
    });
    const motion = makeMotionSnapshot('moving');
    tracker.ingestGpsReading(readingFromPage(point, se12Fit, 8, 10_000), motion);
    expect(tracker.evaluateAt(10_500, true, 'moving')).toMatchObject({
      overlay: { trackingMode: 'pdr' },
    });

    tracker.updateMotion({ ...motion, gyroFresh: false, gyroFreshSince: null });
    expect(tracker.evaluateAt(11_500, true, 'moving')).toMatchObject({
      overlay: { trackingMode: 'matched' },
    });
    expect(tracker.evaluateAt(12_500, false, 'moving').status).toBe('waiting');

    const recovered = { ...motion, gyroFreshSince: 13_500 };
    tracker.updateMotion(recovered);
    expect(tracker.evaluateAt(13_500, false, 'moving').status).toBe('waiting');
    const delayed = { ...readingFromPage(point, se12Fit, 8, 13_000), receivedAt: 13_600 };
    expect(tracker.ingestGpsReading(delayed, recovered)).toMatchObject({
      overlay: { trackingMode: 'motion-gated' },
    });
    expect(tracker.ingestGpsReading(readingFromPage(point, se12Fit, 8, 14_000), recovered)).toMatchObject({
      overlay: { trackingMode: 'pdr' },
    });
  });

  it('disables step advancement on transfers/outdoor and requires a post-transition GPS fix on new floors or after surface load', () => {
    const tracker = new IndoorPdrTracker({ enableParticleFilter: true, seed: 7 });
    const se12Pt = cellToPage(200, 133, se12Surface, se12Plan);
    const moving = makeMotionSnapshot('moving');

    // Start on SE12 F3 while surface is still loading (null) -> raw fallback must NOT seed particles.
    tracker.configureContext({
      plan: se12Plan,
      calibration: se12Calibration,
      surface: null,
      stepKind: 'corridor',
      isSamePlanStep: true,
    });
    const rawWhileLoading = tracker.ingestGpsReading(
      readingFromPage(se12Pt, se12Fit, 6, 10_000),
      moving,
    );
    expect(rawWhileLoading.status).toBe('raw');
    expect(tracker.ingestStep({
      stepIndex: 1,
      stepLengthMetres: 0.7,
      deltaYawRad: 0,
      hasGyro: true,
      turnNoiseRad: 0,
      timestamp: 10_500,
    })).toBe(false);

    // Surface finishes loading -> re-ingesting the pre-surface timestamp 10_000 must stay waiting.
    tracker.configureContext({
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      stepKind: 'corridor',
      isSamePlanStep: true,
    });
    expect(
      tracker.ingestGpsReading(readingFromPage(se12Pt, se12Fit, 6, 10_000), moving).status,
    ).toBe('waiting');

    // Fresh post-surface GPS fix seeds cleanly.
    expect(
      tracker.ingestGpsReading(readingFromPage(se12Pt, se12Fit, 6, 11_000), moving).status,
    ).toBe('matched');

    // Enter stairs transfer step (still displaying SE12 F3) -> stepping must NOT advance dot horizontally.
    tracker.configureContext({
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      stepKind: 'stairs',
      isSamePlanStep: false,
    });
    expect(
      tracker.ingestStep({
        stepIndex: 2,
        stepLengthMetres: 0.7,
        deltaYawRad: 0,
        hasGyro: true,
        turnNoiseRad: 0,
        timestamp: 11_500,
      }),
    ).toBe(false);

    // Enter new floor SW3 F3 -> still-fresh previous-floor GPS fix (11_000) must be rejected!
    const sw3Pt = cellToPage(700, 500, sw3Surface, sw3Plan);
    tracker.configureContext({
      plan: sw3Plan,
      calibration: sw3Calibration,
      surface: sw3Surface,
      stepKind: 'corridor',
      isSamePlanStep: true,
    });
    expect(
      tracker.ingestGpsReading(readingFromPage(sw3Pt, sw3Fit, 6, 11_000), moving).status,
    ).toBe('waiting');
    // Post-transition fix (12_000 > 11_000) succeeds cleanly.
    expect(
      tracker.ingestGpsReading(readingFromPage(sw3Pt, sw3Fit, 6, 12_000), moving).status,
    ).toBe('matched');
  });
});

describe('Three-way comparative simulation benchmarks (Raw GPS vs Existing Matcher vs Stage 1 vs Stage 2)', () => {
  type ScenarioStep = {
    t: number;
    truth: PagePoint;
    gps?: { point: PagePoint; accuracy: number };
    step?: { lengthMetres: number; deltaYawRad: number; turnNoiseRad?: number };
    activity: MotionActivityState;
    /** Optional wrong-corridor boundary check (e.g. y below mid-building is the wrong corridor). */
    isWrongCorridor?: (est: PagePoint) => boolean;
  };

  function runThreeWay(
    events: ScenarioStep[],
    options: { routePath?: PagePoint[]; stepStartPoint?: PagePoint; seed?: number } = {},
  ) {
    let existingPrev: PreviousMatch | null = null;
    const stage1 = new IndoorPdrTracker({ enableParticleFilter: false, seed: options.seed ?? 11 });
    const stage2 = new IndoorPdrTracker({ enableParticleFilter: true, seed: options.seed ?? 11 });
    const ctx = {
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      stepKind: 'corridor' as const,
      isSamePlanStep: true,
      routePath: options.routePath,
      stepStartPoint: options.stepStartPoint,
    };
    stage1.configureContext(ctx);
    stage2.configureContext(ctx);

    const rawErrors: number[] = [];
    const existingErrors: number[] = [];
    const stage1Errors: number[] = [];
    const stage2Errors: number[] = [];
    let existingWrong = 0;
    let stage1Wrong = 0;
    let stage2Wrong = 0;
    let existingAvail = 0;
    let stage1Avail = 0;
    let stage2Avail = 0;
    let lastGpsTime = -Infinity;
    let lastExistingPt: PagePoint | null = null;
    let stepIndex = 0;
    let totalStepDist = 0;
    let stage1FirstPt: PagePoint | null = null;
    let existingMaxDrift = 0;
    let stage1MaxDrift = 0;
    let existingFirstPt: PagePoint | null = null;

    for (const ev of events) {
      if (ev.step) {
        stepIndex += 1;
        totalStepDist += ev.step.lengthMetres;
        const detected: DetectedStep = {
          stepIndex,
          stepLengthMetres: ev.step.lengthMetres,
          deltaYawRad: ev.step.deltaYawRad,
          hasGyro: true,
          turnNoiseRad: ev.step.turnNoiseRad ?? 0,
          timestamp: ev.t,
        };
        stage1.ingestStep(detected);
        stage2.ingestStep(detected);
      }

      const snap = makeMotionSnapshot(ev.activity, {
        stepCount: stepIndex,
        estimatedDistanceMetres: totalStepDist,
        lastStepAt: ev.step ? ev.t : null,
        lastEventAt: ev.t,
      });

      if (ev.gps) {
        lastGpsTime = ev.t;
        const reading = readingFromPage(ev.gps.point, se12Fit, ev.gps.accuracy, ev.t);
        rawErrors.push(distMetres(ev.gps.point, ev.truth, se12Plan, se12Fit.scale));

        const ex = matchDeviceToFloor({
          reading,
          plan: se12Plan,
          calibration: se12Calibration,
          surface: se12Surface,
          routePath: options.routePath,
          stepKind: 'corridor',
          previous: existingPrev,
        });
        if (ex.status === 'matched') {
          existingPrev = { point: ex.overlay.point, timestamp: ev.t };
          lastExistingPt = ex.overlay.point;
        } else {
          lastExistingPt = null;
        }
        stage1.ingestGpsReading(reading, { ...snap, hasGyro: false });
        stage2.ingestGpsReading(reading, snap);
      }

      const freshGps = ev.t - lastGpsTime <= 2000;
      if (freshGps && lastExistingPt) {
        existingAvail += 1;
        existingErrors.push(distMetres(lastExistingPt, ev.truth, se12Plan, se12Fit.scale));
        if (!existingFirstPt) existingFirstPt = lastExistingPt;
        existingMaxDrift = Math.max(
          existingMaxDrift,
          distMetres(lastExistingPt, existingFirstPt, se12Plan, se12Fit.scale),
        );
        if (ev.isWrongCorridor?.(lastExistingPt)) existingWrong += 1;
      }

      const eval1 = stage1.evaluateAt(ev.t, freshGps, ev.activity);
      if (eval1.status === 'matched' || eval1.status === 'bridged') {
        stage1Avail += 1;
        stage1Errors.push(distMetres(eval1.overlay.point, ev.truth, se12Plan, se12Fit.scale));
        if (!stage1FirstPt) stage1FirstPt = eval1.overlay.point;
        stage1MaxDrift = Math.max(
          stage1MaxDrift,
          distMetres(eval1.overlay.point, stage1FirstPt, se12Plan, se12Fit.scale),
        );
        if (ev.isWrongCorridor?.(eval1.overlay.point)) stage1Wrong += 1;
      }

      const eval2 = stage2.evaluateAt(ev.t, freshGps, ev.activity);
      if (eval2.status === 'matched' || eval2.status === 'bridged') {
        stage2Avail += 1;
        stage2Errors.push(distMetres(eval2.overlay.point, ev.truth, se12Plan, se12Fit.scale));
        if (ev.isWrongCorridor?.(eval2.overlay.point)) stage2Wrong += 1;
      }
    }

    return {
      rawMedian: median(rawErrors),
      existingMedian: median(existingErrors),
      existingP90: p90(existingErrors),
      stage1Median: median(stage1Errors),
      stage1P90: p90(stage1Errors),
      stage2Median: median(stage2Errors),
      stage2P90: p90(stage2Errors),
      existingMaxDrift,
      stage1MaxDrift,
      existingWrong,
      stage1Wrong,
      stage2Wrong,
      existingAvailRate: existingAvail / events.length,
      stage1AvailRate: stage1Avail / events.length,
      stage2AvailRate: stage2Avail / events.length,
    };
  }

  it('beats existing corridor matcher on stationary drift (Stage 1 = 0 m vs existing drift) under 10 m oscillating bias', () => {
    const truth = cellToPage(200, 133, se12Surface, se12Plan);
    const events: ScenarioStep[] = [];
    for (let i = 0; i < 20; i++) {
      const dxM = i === 0 ? 0 : i % 2 === 0 ? 7.5 : -7.5;
      const dyM = i === 0 ? 0 : -10.0; // 10 m exterior pull north of SE12 F3
      events.push({
        t: 10_000 + i * 1500,
        truth,
        activity: 'stationary',
        gps: {
          point: {
            x: truth.x + (dxM * se12Fit.scale) / se12Plan.width,
            y: truth.y + (dyM * se12Fit.scale) / se12Plan.height,
          },
          accuracy: 8,
        },
      });
    }
    const res = runThreeWay(events);
    expect(res.stage1MaxDrift).toBeCloseTo(0, 5);
    expect(res.existingMaxDrift).toBeGreaterThan(2.0);
    expect(res.stage1Median).toBeLessThan(res.existingMedian);
  });

  it('Stage 2 outperforms both raw GPS and existing matcher across straight exterior-biased walk, slow walk, 90 deg turn, and 8 s GPS dead zone', () => {
    // Walk East along SE12 F3 North corridor (gy=133, gx=155 -> 275), then 90 deg right turn South down gx=275 (gy=133 -> 205).
    const events: ScenarioStep[] = [];
    let t = 10_000;
    let xPx = (155 + 0.5) * se12Surface.step;
    let yPx = (133 + 0.5) * se12Surface.step;
    const stepM = 0.7;
    const stepPx = stepM * se12Fit.scale;

    // Phase 1: 35 steps East (~24.5 m), GPS every 3 steps with persistent 9 m north exterior bias + alternating along-track jitter.
    for (let i = 0; i < 38; i++) {
      const isSlow = i >= 12 && i < 20; // Slow walking (~0.55 m/s) mid-corridor
      const dt = isSlow ? 1100 : 550;
      const dist = isSlow ? 0.58 : stepM;
      if (i > 0) xPx += dist * se12Fit.scale;
      const truth = { x: xPx / se12Plan.width, y: yPx / se12Plan.height };
      const inDeadZone = i >= 22 && i < 34; // ~7.2 s indoor GPS dead zone
      const hasGps = !inDeadZone && i % 3 === 0;
      const alongJitterM = i % 2 === 0 ? 5.5 : -5.5;
      events.push({
        t,
        truth,
        activity: 'moving',
        step: i === 0 ? undefined : { lengthMetres: dist, deltaYawRad: 0 },
        gps: hasGps
          ? {
              point: {
                x: truth.x + (alongJitterM * se12Fit.scale) / se12Plan.width,
                y: truth.y - (9.0 * se12Fit.scale) / se12Plan.height,
              },
              accuracy: 7,
            }
          : undefined,
      });
      t += dt;
    }

    // Phase 2: 90 deg RIGHT turn South (world CW = -pi/2 rad) down central cross-corridor gx=275!
    xPx = (275 + 0.5) * se12Surface.step;
    for (let i = 0; i < 20; i++) {
      yPx += stepPx;
      const truth = { x: xPx / se12Plan.width, y: yPx / se12Plan.height };
      const hasGps = i % 3 === 0;
      const crossJitterM = i % 2 === 0 ? 4.5 : -4.5;
      events.push({
        t,
        truth,
        activity: 'moving',
        step: { lengthMetres: stepM, deltaYawRad: i === 0 ? -Math.PI / 2 : 0 },
        gps: hasGps
          ? {
              point: {
                x: truth.x + (crossJitterM * se12Fit.scale) / se12Plan.width,
                y: truth.y + ((i % 2 === 0 ? -4.0 : 4.0) * se12Fit.scale) / se12Plan.height,
              },
              accuracy: 8,
            }
          : undefined,
      });
      t += 550;
    }

    const res = runThreeWay(events, {
      stepStartPoint: cellToPage(155, 133, se12Surface, se12Plan),
    });

    // Stage 2 must improve median error over BOTH raw GPS AND existing corridor matcher, AND boost dead-zone availability!
    expect(res.stage2Median).toBeLessThan(res.rawMedian);
    expect(res.stage2Median).toBeLessThan(res.existingMedian);
    expect(res.stage2AvailRate).toBeGreaterThan(res.existingAvailRate);
  });

  it('survives a phone-only 90 deg horizontal twist while walking straight, follows a genuine detour, and recovers from kidnapped-robot displacement', () => {
    // 1. Phone-only 90 deg horizontal twist while walking straight East along SE12 F3 North corridor.
    const twistEvents: ScenarioStep[] = [];
    let t = 20_000;
    let xPx = (140 + 0.5) * se12Surface.step;
    const yPx = (133 + 0.5) * se12Surface.step;
    for (let i = 0; i < 28; i++) {
      if (i > 0) xPx += 0.7 * se12Fit.scale;
      const truth = { x: xPx / se12Plan.width, y: yPx / se12Plan.height };
      twistEvents.push({
        t,
        truth,
        activity: 'moving',
        // At step 12, user rotates phone 90 deg flat in hand while continuing straight East!
        step: i === 0 ? undefined : { lengthMetres: 0.7, deltaYawRad: i === 12 ? Math.PI / 2 : 0 },
        gps: i % 2 === 0 ? { point: truth, accuracy: 7 } : undefined,
      });
      t += 550;
    }
    const twistRes = runThreeWay(twistEvents, {
      stepStartPoint: cellToPage(140, 133, se12Surface, se12Plan),
    });
    expect(twistRes.stage2Median).toBeLessThan(4.5);

    // 2. Genuine off-route detour: planned route stays East on gy=133, visitor turns South down gx=275 to gy=236!
    const routeLine = [
      cellToPage(220, 133, se12Surface, se12Plan),
      cellToPage(380, 133, se12Surface, se12Plan),
    ];
    const tracker = new IndoorPdrTracker({ enableParticleFilter: true, seed: 19 });
    tracker.configureContext({
      plan: se12Plan,
      calibration: se12Calibration,
      surface: se12Surface,
      stepKind: 'corridor',
      isSamePlanStep: true,
      routePath: routeLine,
    });
    const moving = makeMotionSnapshot('moving');
    let dt = 30_000;
    let gx = 240;
    let gy = 133;
    for (let i = 0; i < 25; i++) {
      if (i < 10) gx += 3.5;
      else gy += 3.5; // ~0.76 m/step down gx=275, matching stepLengthMetres=0.75
      const truth = cellToPage(Math.round(gx), Math.round(gy), se12Surface, se12Plan);
      tracker.ingestStep({
        stepIndex: i + 1,
        stepLengthMetres: 0.75,
        deltaYawRad: i === 10 ? -Math.PI / 2 : 0,
        hasGyro: true,
        turnNoiseRad: 0,
        timestamp: dt,
      });
      tracker.ingestGpsReading(readingFromPage(truth, se12Fit, 7, dt + 100), moving);
      dt += 700;
    }
    const detourTruth = cellToPage(Math.round(gx), Math.round(gy), se12Surface, se12Plan);
    const detourEval = tracker.evaluateAt(dt, true, 'moving');
    expect(detourEval.status).toBe('matched');
    if (detourEval.status === 'matched') {
      // Must honestly follow the visitor down the detour corridor (far south of routeLine gy=133).
      expect(distMetres(detourEval.overlay.point, detourTruth, se12Plan, se12Fit.scale)).toBeLessThan(5.0);
    }

    // 3. Kidnapped-robot recovery: user pockets phone and walks 30 m to South corridor (gx=200, gy=236) with 0 steps detected.
    const teleported = cellToPage(200, 236, se12Surface, se12Plan);
    let recoveredFixes = 0;
    for (let fix = 1; fix <= 4; fix++) {
      dt += 1200;
      const ev = tracker.ingestGpsReading(readingFromPage(teleported, se12Fit, 7, dt), moving);
      if (
        ev.status === 'matched' &&
        distMetres(ev.overlay.point, teleported, se12Plan, se12Fit.scale) < 6.0
      ) {
        recoveredFixes = fix;
        break;
      }
    }
    expect(recoveredFixes).toBeGreaterThan(0);
    expect(recoveredFixes).toBeLessThanOrEqual(4);
  });
});

describe('GuidedDirections DOM integration (iOS fallback, background return, fused status, & Stage 2 bridge)', () => {
  it('rejects a delayed pre-transition fix while accepting fixes during ordinary corridor progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

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
    const [first, ...remaining] = route.steps;
    route.steps = [first, { ...first }, ...remaining];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const nextStep = () => act(async () => {
      [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Next step')!.click();
    });
    const emit = (point: PagePoint, fit: ReturnType<typeof fitCalibration>, timestamp: number) =>
      act(async () => reportLocation({
        coords: { ...fit.unproject(point), accuracy: 7 },
        timestamp,
      } as GeolocationPosition));
    const dot = () => host.querySelector('.device-position');
    const se12Point = cellToPage(200, 133, se12Surface, se12Plan);
    const sw3Point = cellToPage(700, 500, sw3Surface, sw3Plan);

    try {
      await act(async () => root.render(createElement(RouteDirections, {
        route,
        plans: pilotEvidence().map((page) => page.plan),
        locationCatalogue: catalogue,
        walkingSurfaces: { [se12Plan.id]: se12Surface, [sw3Plan.id]: sw3Surface },
        onRecheck: vi.fn(),
      })));
      await emit(se12Point, se12Fit, 20_000);
      expect(dot()).not.toBeNull();
      await act(async () => vi.advanceTimersByTime(200));
      await nextStep();
      expect(dot()).not.toBeNull();
      await nextStep();
      expect(dot()).toBeNull();
      await act(async () => vi.advanceTimersByTime(500));
      await nextStep();
      expect(host.querySelector('.map-floor-badge')?.textContent).toContain('SW03');

      // Both fixes are fresh and have new timestamps. Only the second was captured on this step.
      await act(async () => vi.advanceTimersByTime(100));
      await emit(sw3Point, sw3Fit, 20_600);
      expect(dot()).toBeNull();
      await emit(sw3Point, sw3Fit, 20_800);
      expect(dot()).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('handles iOS motion denial, auto-restarts on visibility return when hidden-paused (but not denied), and keeps viewBox stable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);

    const requestPermission = vi.fn<() => Promise<'granted' | 'denied'>>().mockResolvedValue('denied');
    vi.stubGlobal('DeviceMotionEvent', { requestPermission });

    let reportLocation: PositionCallback = () => {};
    let reportError: PositionErrorCallback = () => {};
    const watchPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
      reportLocation = success;
      reportError = error ?? (() => {});
      return 12;
    });
    const clearWatch = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });

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
      const pt = se12Fit.unproject(cellToPage(200, 133, se12Surface, se12Plan));
      await act(async () =>
        reportLocation({
          coords: { latitude: pt.latitude, longitude: pt.longitude, accuracy: 7 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );
      expect(host.querySelector('.device-position')).not.toBeNull();
      expect(host.querySelector('.walking-map')?.getAttribute('viewBox')).toBe(initialViewBox);

      // Tapping Show full floor triggers the one-time iOS motion prompt; denial degrades cleanly to Tier 1.
      const fab = host.querySelector('.map-floating-fab') as HTMLButtonElement;
      await act(async () => {
        fab.click();
        await Promise.resolve();
      });
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(host.querySelector('.guided-location-status')?.textContent).toContain('Approx. GPS');
      expect(host.querySelector('.device-position')?.getAttribute('data-tracking-mode')).toBe(
        'matched',
      );

      // Background hide pauses watch; returning visible auto-restarts watch!
      hidden = true;
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      expect(clearWatch).toHaveBeenCalled();
      const watchesBeforeReturn = watchPosition.mock.calls.length;

      await act(async () => vi.advanceTimersByTime(500));
      hidden = false;
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      expect(watchPosition.mock.calls.length).toBe(watchesBeforeReturn + 1);
      await act(async () => vi.advanceTimersByTime(100));
      await act(async () => reportLocation({
        coords: { ...pt, accuracy: 7 },
        timestamp: 20_400,
      } as GeolocationPosition));
      expect(host.querySelector('.device-position')).toBeNull();
      await act(async () => reportLocation({
        coords: { ...pt, accuracy: 7 },
        timestamp: 20_600,
      } as GeolocationPosition));
      expect(host.querySelector('.device-position')).not.toBeNull();

      // Permission denial must NOT auto-restart on visibility toggle.
      await act(async () => reportError({ code: 1 } as GeolocationPositionError));
      const watchesAfterDeny = watchPosition.mock.calls.length;
      hidden = true;
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      hidden = false;
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      expect(watchPosition.mock.calls.length).toBe(watchesAfterDeny);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('labels fused tracking and ends a Stage 2 bridge when only the gyroscope goes silent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    // Android-style browser (no requestPermission needed -> motion starts automatically on Step 1).
    vi.stubGlobal('DeviceMotionEvent', function MockDeviceMotion() {});

    let reportLocation: PositionCallback = () => {};
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: vi.fn((success: PositionCallback) => {
          reportLocation = success;
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
            enableParticlePdr: true,
            onRecheck: vi.fn(),
          }),
        ),
      );

      const startPt = cellToPage(160, 133, se12Surface, se12Plan);
      // Warm up motion stream + walk East (~15 m) across 7 GPS fixes so Tier 3 direction resolves.
      for (let k = 0; k < 7; k++) {
        const truth = se12Fit.unproject({
          x: startPt.x + (k * 2.1 * se12Fit.scale) / se12Plan.width,
          y: startPt.y,
        });
        await act(async () => {
          reportLocation({
            coords: { latitude: truth.latitude, longitude: truth.longitude, accuracy: 7 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        });
        for (let stepIdx = 0; stepIdx < 3; stepIdx++) {
          for (let frame = 0; frame < 30; frame++) {
            const bounce = 2.8 * Math.sin((2 * Math.PI * (frame * 20)) / 600);
            await act(async () => {
              dispatchDeviceMotion(
                { x: 0, y: 9.81 + bounce, z: 0 },
                { alpha: 0, beta: 0.01, gamma: 0 },
              );
              vi.advanceTimersByTime(20);
            });
          }
        }
      }

      const finalTruth = se12Fit.unproject({
        x: startPt.x + (15 * se12Fit.scale) / se12Plan.width,
        y: startPt.y,
      });
      await act(async () => {
        reportLocation({
          coords: { latitude: finalTruth.latitude, longitude: finalTruth.longitude, accuracy: 7 },
          timestamp: Date.now(),
        } as GeolocationPosition);
      });

      expect(host.querySelector('.guided-location-status')?.textContent).toContain(
        'Approx. corridor GPS + motion',
      );
      expect(host.querySelector('.device-position')?.getAttribute('data-tracking-mode')).toBe('pdr');

      // Advance 4 s without GPS while keeping motion stream alive -> bounded PDR bridging!
      for (let i = 0; i < 200; i++) {
        const bounce = 2.6 * Math.sin((2 * Math.PI * (i * 20)) / 600);
        await act(async () => {
          dispatchDeviceMotion({ x: 0, y: 9.81 + bounce, z: 0 }, { alpha: 0, beta: 0.01, gamma: 0 });
          vi.advanceTimersByTime(20);
        });
      }
      expect(host.querySelector('.device-position')?.getAttribute('data-tracking-mode')).toBe(
        'pdr-bridged',
      );
      expect(host.querySelector('.guided-location-status')?.textContent).toContain(
        'Approx. step tracking · waiting for GPS…',
      );

      for (let i = 0; i < 90; i++) {
        await act(async () => {
          dispatchDeviceMotion({ x: 0, y: 9.81, z: 0 });
          vi.advanceTimersByTime(20);
        });
      }
      expect(host.querySelector('.device-position')).toBeNull();
      expect(host.querySelector('.guided-location-status')?.textContent).toContain(
        'Waiting for a fresh GPS update…',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
