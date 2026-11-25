/**
 * Browser DeviceMotionEvent adapter with explicit permission caching, raw axis passthrough,
 * and sensor-silence watchdog. Keeps all motion telemetry strictly in browser memory.
 */
import { DEFAULT_SENSOR_CONVENTION, StepMotionEstimator } from './pdr-motion';
import type {
  DetectedStep,
  MotionPermissionState,
  MotionSnapshot,
  SensorConvention,
} from './types';

type DeviceMotionWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};
type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

let cachedPermission: MotionPermissionState = 'unknown';
let cachedOrientationPermission: MotionPermissionState = 'unknown';
let inFlightPermissionRequest: Promise<MotionPermissionState> | null = null;
const permissionListeners = new Set<() => void>();

function notifyPermissionListeners() {
  for (const listener of permissionListeners) listener();
}

/** Subscribe to motion/orientation permission cache transitions across mounted views. */
export function subscribeSensorPermissions(listener: () => void): () => void {
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
  };
}

function motionConstructor(): DeviceMotionWithPermission | undefined {
  return typeof DeviceMotionEvent !== 'undefined'
    ? (DeviceMotionEvent as DeviceMotionWithPermission)
    : undefined;
}

function orientationConstructor(): DeviceOrientationWithPermission | undefined {
  return typeof DeviceOrientationEvent !== 'undefined'
    ? (DeviceOrientationEvent as DeviceOrientationWithPermission)
    : undefined;
}

export function isMotionSupported(): boolean {
  return Boolean(globalThis.isSecureContext && motionConstructor());
}

export function isOrientationSupported(): boolean {
  return Boolean(globalThis.isSecureContext && orientationConstructor());
}

/**
 * Determine platform sensor convention independently from requestPermission() presence.
 * Apple CoreMotion negates accelerationIncludingGravity relative to W3C (+9.81 vs -9.81 face-up)
 * and follows W3C/CoreMotion rotationRate ordering (alpha=Z, beta=X, gamma=Y -> 'zxy').
 */
export function detectSensorConvention(
  nav:
    Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = globalThis.navigator,
): SensorConvention {
  const ua = nav?.userAgent ?? '';
  const isAppleMobile =
    /iPad|iPhone|iPod/.test(ua) || (nav?.platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1);
  return {
    rotationAxisOrder: isAppleMobile ? 'zxy' : DEFAULT_SENSOR_CONVENTION.rotationAxisOrder,
    gravitySign: isAppleMobile ? -1 : 1,
  };
}

export function getMotionPermissionState(): MotionPermissionState {
  if (!isMotionSupported()) return 'unsupported';
  const ctor = motionConstructor();
  if (typeof ctor?.requestPermission !== 'function') return 'granted';
  return cachedPermission;
}

export function getOrientationPermissionState(): MotionPermissionState {
  if (!isOrientationSupported()) return 'unsupported';
  const ctor = orientationConstructor();
  if (typeof ctor?.requestPermission !== 'function') return 'granted';
  return cachedOrientationPermission;
}

/** Stable primitive snapshot for React useSyncExternalStore across permission transitions. */
export function getSensorPermissionSnapshot(): string {
  return `${getMotionPermissionState()}:${getOrientationPermissionState()}`;
}

function invokePermissionSynchronously(
  requestPermission: () => Promise<'granted' | 'denied'>,
): Promise<'granted' | 'denied'> {
  try {
    return Promise.resolve(requestPermission());
  } catch (error) {
    return Promise.reject(error);
  }
}

function settlePermissionResult(
  current: MotionPermissionState,
  settled: PromiseSettledResult<'granted' | 'denied'>,
): MotionPermissionState {
  if (settled.status === 'fulfilled') {
    return settled.value === 'granted' ? 'granted' : 'denied';
  }
  // Preserve 'unknown' on NotAllowedError so a subsequent user tap can still prompt.
  const name = (settled.reason as { name?: string } | null)?.name;
  return name === 'NotAllowedError' ? current : 'denied';
}

/**
 * Request browser motion and orientation permission (required on iOS 13+ WebKit within a user tap).
 * Both APIs must be invoked synchronously before any await so WebKit preserves transient user
 * activation for both calls; settlement notifies mounted trackers even across route transitions.
 */
export function requestMotionPermission(): Promise<MotionPermissionState> {
  if (inFlightPermissionRequest) return inFlightPermissionRequest;

  const motionCtor = isMotionSupported() ? motionConstructor() : undefined;
  const orientCtor = isOrientationSupported() ? orientationConstructor() : undefined;
  const prevMotion = cachedPermission;
  const prevOrient = cachedOrientationPermission;

  let motionPromise: Promise<'granted' | 'denied'> | null = null;
  let orientPromise: Promise<'granted' | 'denied'> | null = null;

  if (motionCtor) {
    if (typeof motionCtor.requestPermission !== 'function') {
      cachedPermission = 'granted';
    } else if (cachedPermission === 'unknown') {
      motionPromise = invokePermissionSynchronously(() => motionCtor.requestPermission!());
    }
  }

  if (orientCtor) {
    if (typeof orientCtor.requestPermission !== 'function') {
      cachedOrientationPermission = 'granted';
    } else if (cachedOrientationPermission === 'unknown') {
      if (cachedPermission === 'denied') {
        cachedOrientationPermission = 'denied';
      } else {
        orientPromise = invokePermissionSynchronously(() => orientCtor.requestPermission!());
      }
    }
  }

  if (!motionPromise && !orientPromise) {
    if (cachedPermission !== prevMotion || cachedOrientationPermission !== prevOrient) {
      notifyPermissionListeners();
    }
    return Promise.resolve(motionCtor ? cachedPermission : 'unsupported');
  }

  const request = (async () => {
    try {
      const [motionResult, orientResult] = await Promise.allSettled([
        motionPromise ?? Promise.resolve<'granted' | 'denied'>('denied'),
        orientPromise ?? Promise.resolve<'granted' | 'denied'>('denied'),
      ]);
      if (motionPromise) {
        cachedPermission = settlePermissionResult(cachedPermission, motionResult);
      }
      if (orientPromise) {
        cachedOrientationPermission = settlePermissionResult(
          cachedOrientationPermission,
          orientResult,
        );
      }
      return motionCtor ? cachedPermission : 'unsupported';
    } finally {
      inFlightPermissionRequest = null;
      if (cachedPermission !== prevMotion || cachedOrientationPermission !== prevOrient) {
        notifyPermissionListeners();
      }
    }
  })();

  inFlightPermissionRequest = request;
  return request;
}

export function resetMotionPermissionCacheForTests() {
  cachedPermission = 'unknown';
  cachedOrientationPermission = 'unknown';
  inFlightPermissionRequest = null;
  permissionListeners.clear();
}

export class BrowserMotion {
  private readonly estimator: StepMotionEstimator;
  private readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  private active = false;
  private handler: ((event: Event) => void) | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(options?: {
    convention?: Partial<SensorConvention>;
    target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  }) {
    const baseConvention = detectSensorConvention();
    this.estimator = new StepMotionEstimator({ ...baseConvention, ...options?.convention });
    this.target = options?.target ?? window;
  }

  snapshot(): MotionSnapshot {
    const permission = getMotionPermissionState();
    return {
      supported: isMotionSupported(),
      permission,
      active: this.active,
      ...this.estimator.snapshot(),
    };
  }

  start(
    onStep: (step: DetectedStep, snapshot: MotionSnapshot) => void,
    onSnapshotChange: (snapshot: MotionSnapshot) => void,
    onGyroYaw?: (omegaCcwRadPerSec: number, timestamp: number) => void,
  ) {
    this.stop();
    if (!isMotionSupported() || getMotionPermissionState() !== 'granted') {
      onSnapshotChange(this.snapshot());
      return;
    }
    this.active = true;
    this.estimator.resetAll();
    onSnapshotChange(this.snapshot());

    this.handler = (rawEvent: Event) => {
      if (!this.active) return;
      const event = rawEvent as DeviceMotionEvent;
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
      const rot = event.rotationRate;
      const timestamp = Date.now();
      const result = this.estimator.ingest({
        ax: acc.x,
        ay: acc.y,
        az: acc.z,
        rotAlpha: rot?.alpha ?? null,
        rotBeta: rot?.beta ?? null,
        rotGamma: rot?.gamma ?? null,
        timestamp,
      });
      // Wait for initial activity classification (~600 ms) before forwarding live yaw to the
      // heading cone so uncalibrated startup gyro bias cannot clear a quiet compass anchor.
      if (result.omegaCcwRadPerSec !== null && this.estimator.snapshot().activity !== 'unknown') {
        onGyroYaw?.(result.omegaCcwRadPerSec, timestamp);
      }
      if (result.step) {
        onStep(result.step, this.snapshot());
      } else if (
        result.activityChanged ||
        result.capabilityChanged ||
        result.gyroFreshnessChanged
      ) {
        onSnapshotChange(this.snapshot());
      }
    };

    this.target.addEventListener('devicemotion', this.handler);
    // Check gyro continuity and accelerometer activity even when callbacks stop.
    this.watchdog = setInterval(() => {
      if (!this.active) return;
      if (this.estimator.checkFreshness(Date.now())) {
        onSnapshotChange(this.snapshot());
      }
    }, 250);
  }

  stop(notify?: (snapshot: MotionSnapshot) => void) {
    const wasActive = this.active;
    this.active = false;
    if (this.handler) {
      this.target.removeEventListener('devicemotion', this.handler);
      this.handler = null;
    }
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.estimator.resetAll();
    if (wasActive && notify) notify(this.snapshot());
  }
}
