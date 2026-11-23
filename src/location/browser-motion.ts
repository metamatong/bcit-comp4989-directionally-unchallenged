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

let cachedPermission: MotionPermissionState = 'unknown';

function motionConstructor(): DeviceMotionWithPermission | undefined {
  return typeof DeviceMotionEvent !== 'undefined'
    ? (DeviceMotionEvent as DeviceMotionWithPermission)
    : undefined;
}

export function isMotionSupported(): boolean {
  return Boolean(globalThis.isSecureContext && motionConstructor());
}

/**
 * Determine platform sensor convention independently from requestPermission() presence.
 * Apple CoreMotion negates accelerationIncludingGravity relative to W3C (+9.81 vs -9.81 face-up).
 */
export function detectSensorConvention(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = globalThis.navigator,
): SensorConvention {
  const ua = nav?.userAgent ?? '';
  const isAppleMobile =
    /iPad|iPhone|iPod/.test(ua) ||
    (nav?.platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1);
  return {
    rotationAxisOrder: DEFAULT_SENSOR_CONVENTION.rotationAxisOrder,
    gravitySign: isAppleMobile ? -1 : 1,
  };
}

export function getMotionPermissionState(): MotionPermissionState {
  if (!isMotionSupported()) return 'unsupported';
  const ctor = motionConstructor();
  if (typeof ctor?.requestPermission !== 'function') return 'granted';
  return cachedPermission;
}

/**
 * Request browser motion permission (required on iOS 13+ WebKit within a user tap).
 * Never blocks or throws; resolves to the resulting MotionPermissionState.
 */
export async function requestMotionPermission(): Promise<MotionPermissionState> {
  if (!isMotionSupported()) return 'unsupported';
  const ctor = motionConstructor();
  if (typeof ctor?.requestPermission !== 'function') {
    cachedPermission = 'granted';
    return 'granted';
  }
  if (cachedPermission === 'granted' || cachedPermission === 'denied') {
    return cachedPermission;
  }
  try {
    const result = await ctor.requestPermission();
    cachedPermission = result === 'granted' ? 'granted' : 'denied';
    return cachedPermission;
  } catch (error) {
    // Preserve 'unknown' if called outside a user gesture so a later tap can still prompt.
    const name = (error as { name?: string } | null)?.name;
    if (name !== 'NotAllowedError') {
      cachedPermission = 'denied';
    }
    return cachedPermission;
  }
}

export function resetMotionPermissionCacheForTests() {
  cachedPermission = 'unknown';
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
      const result = this.estimator.ingest({
        ax: acc.x,
        ay: acc.y,
        az: acc.z,
        rotAlpha: rot?.alpha ?? null,
        rotBeta: rot?.beta ?? null,
        rotGamma: rot?.gamma ?? null,
        timestamp: Date.now(),
      });
      if (result.step) {
        onStep(result.step, this.snapshot());
      } else if (result.activityChanged || result.capabilityChanged || result.gyroFreshnessChanged) {
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
