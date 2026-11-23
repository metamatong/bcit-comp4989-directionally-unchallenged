// @vitest-environment jsdom
/** Deterministic unit tests for pure IMU signal processing and BrowserMotion adapter. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserMotion,
  detectSensorConvention,
  getMotionPermissionState,
  requestMotionPermission,
  resetMotionPermissionCacheForTests,
} from '../src/location/browser-motion';
import { StepMotionEstimator } from '../src/location/pdr-motion';
import type { DetectedStep, MotionSnapshot } from '../src/location/types';

function dispatchMotion(
  target: EventTarget,
  acc: { x: number | null; y: number | null; z: number | null },
  rot?: { alpha: number | null; beta: number | null; gamma: number | null },
) {
  const event = new Event('devicemotion') as DeviceMotionEvent;
  Object.defineProperty(event, 'accelerationIncludingGravity', { value: acc });
  Object.defineProperty(event, 'rotationRate', {
    value: rot ?? { alpha: null, beta: null, gamma: null },
  });
  target.dispatchEvent(event);
}

describe('StepMotionEstimator (pure IMU signal processing)', () => {
  it('classifies steady noise as stationary with 0 steps and tracks gyro bias', () => {
    const estimator = new StepMotionEstimator();
    let t = 1000;
    for (let i = 0; i < 150; i++) {
      // 60 Hz for 2.5 s: slight noise around 9.81 m/s^2 + 1.5 deg/s static Z bias
      const noise = Math.sin(i * 1.7) * 0.05;
      const res = estimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81 + noise,
        rotAlpha: 0,
        rotBeta: 0,
        rotGamma: 1.5,
        timestamp: t,
      });
      expect(res.step).toBeNull();
      t += 16;
    }
    const snap = estimator.snapshot();
    expect(snap.hasAccel).toBe(true);
    expect(snap.hasGyro).toBe(true);
    expect(snap.activity).toBe('stationary');
    expect(snap.stepCount).toBe(0);
  });

  it('detects normal walking (1.8 Hz) at 60 Hz and variable 25-50 Hz sampling with Weinberg stride', () => {
    for (const variableRate of [false, true]) {
      const estimator = new StepMotionEstimator();
      const steps: DetectedStep[] = [];
      let t = 0;
      const durationMs = 5600; // ~10 steps at 1.8 Hz
      let idx = 0;
      while (t <= durationMs) {
        const bounce = 2.6 * Math.sin(2 * Math.PI * 1.8 * (t / 1000));
        const res = estimator.ingest({
          ax: 0,
          ay: 9.81 + bounce,
          az: 0,
          timestamp: t,
        });
        if (res.step) steps.push(res.step);
        t += variableRate ? (idx % 3 === 0 ? 40 : 20) : 16;
        idx++;
      }
      expect(steps.length).toBeGreaterThanOrEqual(9);
      expect(steps.length).toBeLessThanOrEqual(11);
      for (const s of steps) {
        expect(s.stepLengthMetres).toBeGreaterThanOrEqual(0.45);
        expect(s.stepLengthMetres).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it('detects slow corridor strolling (~0.8 Hz) without flipping stationary between strides', () => {
    const estimator = new StepMotionEstimator();
    const steps: DetectedStep[] = [];
    let sawStationaryDuringWalk = false;
    for (let t = 0; t <= 7500; t += 20) {
      const bounce = 1.4 * Math.sin(2 * Math.PI * 0.8 * (t / 1000));
      const res = estimator.ingest({
        ax: 0,
        ay: 9.81 + bounce,
        az: 0,
        timestamp: t,
      });
      if (res.step) steps.push(res.step);
      if (steps.length >= 1 && estimator.snapshot().activity === 'stationary') {
        sawStationaryDuringWalk = true;
      }
    }
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps.length).toBeLessThanOrEqual(7);
    expect(sawStationaryDuringWalk).toBe(false);
  });

  it('rejects rapid hand tremor (<300 ms) and extreme drop spikes (>28 m/s^2)', () => {
    const estimator = new StepMotionEstimator();
    let stepCount = 0;
    // 6 Hz hand tremor (period 166 ms) — attenuated by low-pass and blocked by refractory window.
    for (let t = 0; t <= 3000; t += 16) {
      const tremor = 1.5 * Math.sin(2 * Math.PI * 6 * (t / 1000));
      const res = estimator.ingest({ ax: 0, ay: 0, az: 9.81 + tremor, timestamp: t });
      if (res.step) stepCount++;
    }
    expect(stepCount).toBe(0);

    // Single massive impact spike (>28 m/s^2 peak-to-valley).
    const estimator2 = new StepMotionEstimator();
    const samples = [
      { t: 0, az: 9.81 },
      { t: 20, az: 9.81 },
      { t: 40, az: 39.5 },
      { t: 80, az: 9.81 },
      { t: 120, az: -15.0 },
      { t: 160, az: 9.81 },
    ];
    let spikeSteps = 0;
    for (const s of samples) {
      const res = estimator2.ingest({ ax: 0, ay: 0, az: s.az, timestamp: s.t });
      if (res.step) spikeSteps++;
    }
    expect(spikeSteps).toBe(0);
  });

  it('projects W3C/Chromium rotationRate (alpha=X, beta=Y, gamma=Z) onto gravity across flat, upright, and 45 deg postures on Android (+1) and iOS (-1)', () => {
    const cases: {
      name: string;
      gravitySign: 1 | -1;
      grav: [number, number, number];
      // 90 deg/s CCW left turn around physical UP vector for 1.0 s -> +pi/2 rad
      rot: { alpha: number; beta: number; gamma: number };
      expectedRad: number;
    }[] = [
      {
        name: 'Android flat face-up left turn (gamma = Z)',
        gravitySign: 1,
        grav: [0, 0, 9.81],
        rot: { alpha: 0, beta: 0, gamma: 90 },
        expectedRad: Math.PI / 2,
      },
      {
        name: 'Android flat face-up right turn (gamma = Z)',
        gravitySign: 1,
        grav: [0, 0, 9.81],
        rot: { alpha: 0, beta: 0, gamma: -90 },
        expectedRad: -Math.PI / 2,
      },
      {
        name: 'Android upright portrait left turn (beta = Y)',
        gravitySign: 1,
        grav: [0, 9.81, 0],
        rot: { alpha: 0, beta: 90, gamma: 0 },
        expectedRad: Math.PI / 2,
      },
      {
        name: 'Android 45 deg tilted portrait left turn (beta + gamma)',
        gravitySign: 1,
        grav: [0, 9.81 * Math.SQRT1_2, 9.81 * Math.SQRT1_2],
        rot: { alpha: 0, beta: 90 * Math.SQRT1_2, gamma: 90 * Math.SQRT1_2 },
        expectedRad: Math.PI / 2,
      },
      {
        name: 'iOS flat face-up left turn (negated CoreMotion gravity)',
        gravitySign: -1,
        grav: [0, 0, -9.81],
        rot: { alpha: 0, beta: 0, gamma: 90 },
        expectedRad: Math.PI / 2,
      },
      {
        name: 'iOS upright portrait right turn (negated CoreMotion gravity)',
        gravitySign: -1,
        grav: [0, -9.81, 0],
        rot: { alpha: 0, beta: -90, gamma: 0 },
        expectedRad: -Math.PI / 2,
      },
    ];

    for (const c of cases) {
      const estimator = new StepMotionEstimator({
        rotationAxisOrder: 'xyz',
        gravitySign: c.gravitySign,
      });
      // Establish gravity baseline (500 ms), then turn 90 deg over 1000 ms, then take 1 step.
      let t = 0;
      for (; t < 500; t += 20) {
        estimator.ingest({
          ax: c.grav[0],
          ay: c.grav[1],
          az: c.grav[2],
          rotAlpha: 0.001,
          rotBeta: 0,
          rotGamma: 0,
          timestamp: t,
        });
      }
      for (; t < 1500; t += 20) {
        estimator.ingest({
          ax: c.grav[0],
          ay: c.grav[1],
          az: c.grav[2],
          rotAlpha: c.rot.alpha,
          rotBeta: c.rot.beta,
          rotGamma: c.rot.gamma,
          timestamp: t,
        });
      }
      // Emit one clean step cycle along the physical UP axis.
      const gNorm = Math.hypot(...c.grav);
      const ux = (c.grav[0] / gNorm) * c.gravitySign;
      const uy = (c.grav[1] / gNorm) * c.gravitySign;
      const uz = (c.grav[2] / gNorm) * c.gravitySign;
      let emitted: DetectedStep | null = null;
      for (let dt = 0; dt <= 1000 && !emitted; dt += 20) {
        const bounce = 2.8 * Math.sin((2 * Math.PI * dt) / 600);
        const res = estimator.ingest({
          ax: c.grav[0] + ux * bounce,
          ay: c.grav[1] + uy * bounce,
          az: c.grav[2] + uz * bounce,
          rotAlpha: 0,
          rotBeta: 0,
          rotGamma: 0,
          timestamp: t + dt,
        });
        if (res.step) emitted = res.step;
      }
      expect(emitted, c.name).not.toBeNull();
      expect(emitted!.deltaYawRad, c.name).toBeCloseTo(c.expectedRad, 1);
      // Pure yaw around gravity should generate negligible tilt handling noise.
      expect(emitted!.turnNoiseRad, c.name).toBeLessThan(0.05);
    }
  });

  it('accumulates turnNoiseRad on non-yaw phone tilting and resets across >500 ms frame gaps', () => {
    const estimator = new StepMotionEstimator();
    // Flat face-up phone pitched around X (alpha) at 90 deg/s for 0.5 s -> pure tilt, ~0 yaw.
    for (let t = 0; t <= 500; t += 20) {
      estimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81,
        rotAlpha: 90,
        rotBeta: 0,
        rotGamma: 0,
        timestamp: t,
      });
    }
    // Frame gap > 500 ms should discard pre-gap accumulated yaw/tilt cleanly.
    estimator.ingest({
      ax: 0,
      ay: 0,
      az: 9.81,
      rotAlpha: 0,
      rotBeta: 0,
      rotGamma: 0,
      timestamp: 1500,
    });
    // Now add fresh tilt noise for 400 ms and take one step.
    for (let t = 1520; t <= 1900; t += 20) {
      estimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81,
        rotAlpha: 90,
        rotBeta: 0,
        rotGamma: 0,
        timestamp: t,
      });
    }
    let step: DetectedStep | null = null;
    for (let dt = 0; dt <= 800 && !step; dt += 20) {
      const bounce = 2.8 * Math.sin((2 * Math.PI * dt) / 600);
      const res = estimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81 + bounce,
        rotAlpha: 0,
        rotBeta: 0,
        rotGamma: 0,
        timestamp: 1920 + dt,
      });
      if (res.step) step = res.step;
    }
    expect(step).not.toBeNull();
    expect(Math.abs(step!.deltaYawRad)).toBeLessThan(0.05);
    expect(step!.turnNoiseRad).toBeGreaterThan(0.1);
  });

  it('distinguishes sensor silence (>1.5 s) from standing still', () => {
    const estimator = new StepMotionEstimator();
    for (let t = 0; t <= 1200; t += 20) {
      estimator.ingest({ ax: 0, ay: 0, az: 9.81, timestamp: t });
    }
    expect(estimator.snapshot().activity).toBe('stationary');
    expect(estimator.checkFreshness(2000)).toBe(false);
    expect(estimator.checkFreshness(3000)).toBe(true);
    expect(estimator.snapshot().activity).toBe('unknown');
  });

  it('expires the gyroscope independently and accepts zero rates after recovery', () => {
    const estimator = new StepMotionEstimator();
    const sample = (timestamp: number, rotGamma: number | null) =>
      estimator.ingest({ ax: 0, ay: 0, az: 9.81, rotAlpha: 0, rotBeta: 0, rotGamma, timestamp });
    sample(1000, 90);
    for (let timestamp = 1020; timestamp <= 2600; timestamp += 20) sample(timestamp, 0);
    expect(estimator.snapshot()).toMatchObject({ hasGyro: true, gyroFresh: true, gyroFreshSince: 1000 });

    for (let timestamp = 2620; timestamp <= 3100; timestamp += 20) sample(timestamp, null);
    expect(estimator.snapshot().gyroFresh).toBe(true);
    expect(sample(3101, null).gyroFreshnessChanged).toBe(true);
    expect(estimator.snapshot()).toMatchObject({
      hasGyro: true, gyroFresh: false, gyroFreshSince: null, activity: 'stationary',
    });
    expect(sample(3120, 0).gyroFreshnessChanged).toBe(true);
    expect(estimator.snapshot()).toMatchObject({ gyroFresh: true, gyroFreshSince: 3120 });
    expect(estimator.checkFreshness(3620)).toBe(false);
    expect(estimator.checkFreshness(3621)).toBe(true);
    expect(estimator.snapshot().gyroFresh).toBe(false);
  });

  it('reports a new gyro stream when a valid sample is the first event past the gap limit', () => {
    const estimator = new StepMotionEstimator();
    const sample = (timestamp: number, rotGamma: number | null) =>
      estimator.ingest({ ax: 0, ay: 0, az: 9.81, rotAlpha: 0, rotBeta: 0, rotGamma, timestamp });
    sample(1000, 90);
    for (let timestamp = 1020; timestamp <= 1500; timestamp += 20) sample(timestamp, null);
    expect(estimator.snapshot().gyroFreshSince).toBe(1000);
    expect(sample(1501, 0).gyroFreshnessChanged).toBe(true);
    expect(estimator.snapshot()).toMatchObject({ gyroFresh: true, gyroFreshSince: 1501 });
  });

  it('integrates yaw accurately when gyro arrives at half accel cadence, gates steps on stale gyro, and resets gyro epoch across >500 ms stalls', () => {
    // 1. 50 Hz accel with 25 Hz gyro (every other frame has null rotationRate) turning 90 deg CCW over 1.0 s.
    const estimator = new StepMotionEstimator();
    let t = 0;
    for (let i = 0; i < 25; i++, t += 20) {
      estimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81,
        rotAlpha: i % 2 === 0 ? 0.001 : null,
        rotBeta: i % 2 === 0 ? 0 : null,
        rotGamma: i % 2 === 0 ? 0 : null,
        timestamp: t,
      });
    }
    for (let i = 0; i < 50; i++, t += 20) {
      estimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81,
        rotAlpha: i % 2 === 0 ? 0 : null,
        rotBeta: i % 2 === 0 ? 0 : null,
        rotGamma: i % 2 === 0 ? 90 : null,
        timestamp: t,
      });
    }
    let step: DetectedStep | null = null;
    for (let dt = 0; dt <= 800 && !step; dt += 20) {
      const bounce = 2.8 * Math.sin((2 * Math.PI * dt) / 600);
      const res = estimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81 + bounce,
        rotAlpha: 0,
        rotBeta: 0,
        rotGamma: 0,
        timestamp: t + dt,
      });
      if (res.step) step = res.step;
    }
    expect(step).not.toBeNull();
    expect(step!.hasGyro).toBe(true);
    expect(step!.deltaYawRad).toBeCloseTo(Math.PI / 2, 1);

    // 2. Step emitted ~800 ms into a gyro outage (>500 ms, <1500 ms) must report hasGyro: false and 0 yaw.
    const outEstimator = new StepMotionEstimator();
    let ot = 0;
    for (; ot <= 500; ot += 20) {
      outEstimator.ingest({ ax: 0, ay: 0, az: 9.81, rotAlpha: 0, rotBeta: 0, rotGamma: 45, timestamp: ot });
    }
    // Keep sending acceleration after the gyro continuity limit passes, then take a step.
    for (let k = 0; k < 30; k++, ot += 20) {
      outEstimator.ingest({ ax: 0, ay: 0, az: 9.81, rotAlpha: null, rotBeta: null, rotGamma: null, timestamp: ot });
    }
    let staleGyroStep: DetectedStep | null = null;
    for (let dt = 0; dt <= 800 && !staleGyroStep; dt += 20) {
      const bounce = 2.8 * Math.sin((2 * Math.PI * dt) / 600);
      const res = outEstimator.ingest({
        ax: 0,
        ay: 0,
        az: 9.81 + bounce,
        rotAlpha: null,
        rotBeta: null,
        rotGamma: null,
        timestamp: ot + dt,
      });
      if (res.step) staleGyroStep = res.step;
    }
    expect(staleGyroStep).not.toBeNull();
    expect(staleGyroStep!.hasGyro).toBe(false);
    expect(staleGyroStep!.deltaYawRad).toBe(0);

    // 3. An 800 ms devicemotion stall (>500 ms, <1500 ms) resets activity to 'unknown' and advances gyroFreshSince.
    const stallEstimator = new StepMotionEstimator();
    for (let st = 1000; st <= 2000; st += 20) {
      stallEstimator.ingest({ ax: 0, ay: 0, az: 9.81, rotAlpha: 0, rotBeta: 0, rotGamma: 1, timestamp: st });
    }
    expect(stallEstimator.snapshot().gyroFreshSince).toBe(1000);
    const afterStall = stallEstimator.ingest({
      ax: 0,
      ay: 0,
      az: 9.81,
      rotAlpha: 0,
      rotBeta: 0,
      rotGamma: 0,
      timestamp: 2800,
    });
    expect(afterStall.gyroFreshnessChanged).toBe(true);
    expect(stallEstimator.snapshot()).toMatchObject({
      activity: 'unknown',
      gyroFresh: true,
      gyroFreshSince: 2800,
    });
  });
});

describe('BrowserMotion adapter & permissions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubGlobal('isSecureContext', true);
    resetMotionPermissionCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetMotionPermissionCacheForTests();
  });

  it('handles permission APIs cleanly and decouples sensor convention from requestPermission()', async () => {
    // Non-Apple UA that happens to expose requestPermission() must still use gravitySign = +1.
    expect(
      detectSensorConvention({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toEqual({ rotationAxisOrder: 'xyz', gravitySign: 1 });

    expect(
      detectSensorConvention({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      }),
    ).toEqual({ rotationAxisOrder: 'xyz', gravitySign: -1 });

    const requestPermission = vi
      .fn<() => Promise<'granted' | 'denied'>>()
      .mockRejectedValueOnce(new DOMException('User gesture required', 'NotAllowedError'))
      .mockResolvedValueOnce('granted');
    vi.stubGlobal('DeviceMotionEvent', { requestPermission });

    expect(getMotionPermissionState()).toBe('unknown');
    // NotAllowedError keeps state 'unknown' so a subsequent user tap can retry.
    expect(await requestMotionPermission()).toBe('unknown');
    expect(await requestMotionPermission()).toBe('granted');
    expect(getMotionPermissionState()).toBe('granted');
    // Cached grant does not re-prompt.
    expect(await requestMotionPermission()).toBe('granted');
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });

  it('maps raw DeviceMotionEvent fields directly and drops to unknown on sensor silence', () => {
    vi.stubGlobal('DeviceMotionEvent', function MockDeviceMotionEvent() {});
    const target = new EventTarget();
    const snapshots: MotionSnapshot[] = [];
    const steps: DetectedStep[] = [];
    const motion = new BrowserMotion({
      convention: { rotationAxisOrder: 'xyz', gravitySign: 1 },
      target: target as unknown as Window,
    });

    motion.start(
      (step, snap) => {
        steps.push(step);
        snapshots.push(snap);
      },
      (snap) => snapshots.push(snap),
    );

    // Feed 1.2 s of quiet flat-phone readings -> stationary.
    for (let i = 0; i <= 60; i++) {
      dispatchMotion(target, { x: 0, y: 0, z: 9.81 }, { alpha: 0, beta: 0, gamma: 0.05 });
      vi.advanceTimersByTime(20);
    }
    expect(motion.snapshot().activity).toBe('stationary');
    expect(motion.snapshot().hasGyro).toBe(true);

    // Rotate flat phone 90 deg CCW using raw rotationRate.gamma (Z axis in W3C/Chromium).
    for (let i = 0; i < 50; i++) {
      dispatchMotion(target, { x: 0, y: 0, z: 9.81 }, { alpha: 0, beta: 0, gamma: 90 });
      vi.advanceTimersByTime(20);
    }
    for (let i = 0; i < 40 && steps.length === 0; i++) {
      const bounce = 2.8 * Math.sin((2 * Math.PI * (i * 20)) / 600);
      dispatchMotion(target, { x: 0, y: 0, z: 9.81 + bounce }, { alpha: 0, beta: 0, gamma: 0 });
      vi.advanceTimersByTime(20);
    }
    expect(steps).toHaveLength(1);
    expect(steps[0].deltaYawRad).toBeCloseTo(Math.PI / 2, 1);

    // The watchdog expires the gyro before the accelerometer activity goes unknown.
    vi.advanceTimersByTime(750);
    expect(snapshots.at(-1)?.gyroFresh).toBe(false);
    expect(motion.snapshot().activity).toBe('moving');
    vi.advanceTimersByTime(1750);
    expect(motion.snapshot().activity).toBe('unknown');

    motion.stop();
  });
});
