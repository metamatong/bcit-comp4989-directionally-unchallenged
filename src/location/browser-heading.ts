/**
 * Browser DeviceOrientationEvent adapter for the live directional heading cone.
 * Prefers deviceorientationabsolute on Android Chrome, supports iOS webkitCompassHeading,
 * fuses live gyro yaw off React's render loop, and throttles UI updates cleanly.
 * Keeps all orientation data strictly in active browser memory.
 */
import { getOrientationPermissionState, isOrientationSupported } from './browser-motion';
import { HeadingEstimator, type PdrHeadingFallback, wrapAngleRad } from './heading';
import type { DeviceHeading } from './types';

type WebKitDeviceOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

const MIN_EMIT_INTERVAL_MS = 75;
const MIN_EMIT_DELTA_RAD = (3 * Math.PI) / 180;

function readScreenAngleDeg(): number {
  const angle = globalThis.screen?.orientation?.angle;
  if (typeof angle === 'number' && Number.isFinite(angle)) return angle;
  const legacy = (globalThis as { orientation?: unknown }).orientation;
  return typeof legacy === 'number' && Number.isFinite(legacy) ? legacy : 0;
}

function headingMateriallyChanged(prev: DeviceHeading | null, next: DeviceHeading | null): boolean {
  if (prev === null && next === null) return false;
  if (prev === null || next === null) return true;
  if (prev.source !== next.source || prev.spreadDeg !== next.spreadDeg) return true;
  return Math.abs(wrapAngleRad(next.angleRad - prev.angleRad)) >= MIN_EMIT_DELTA_RAD;
}

export class BrowserHeading {
  private readonly estimator = new HeadingEstimator();
  private readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  private active = false;
  private sawAbsoluteEvent = false;
  private absoluteHandler: ((event: Event) => void) | null = null;
  private orientationHandler: ((event: Event) => void) | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private bearingToPlanAngle: ((trueBearingRad: number) => number) | null = null;
  private pdrFallback: PdrHeadingFallback | null = null;
  private onChange: ((heading: DeviceHeading | null) => void) | null = null;
  private lastEmitted: DeviceHeading | null = null;
  private lastEmitAt = -Infinity;

  constructor(options?: { target?: Pick<Window, 'addEventListener' | 'removeEventListener'> }) {
    this.target = options?.target ?? window;
  }

  setBearingTransform(fn: ((trueBearingRad: number) => number) | null) {
    this.bearingToPlanAngle = fn;
    if (this.active) this.emitIfChanged(Date.now(), true);
  }

  setPdrFallback(fallback: PdrHeadingFallback | null) {
    this.pdrFallback = fallback;
    if (this.active) this.emitIfChanged(Date.now(), true);
  }

  ingestGyroYaw(omegaCcwRadPerSec: number, timestamp: number) {
    if (!this.active) return;
    if (this.estimator.ingestGyroYaw(omegaCcwRadPerSec, timestamp)) {
      this.emitIfChanged(timestamp, false);
    }
  }

  start(onChange: (heading: DeviceHeading | null) => void) {
    this.stop();
    this.active = true;
    this.sawAbsoluteEvent = false;
    this.onChange = onChange;
    this.lastEmitted = null;
    this.lastEmitAt = -Infinity;
    this.estimator.reset();

    if (isOrientationSupported() && getOrientationPermissionState() === 'granted') {
      const handleEvent = (rawEvent: Event, forceAbsolute: boolean) => {
        if (!this.active) return;
        const event = rawEvent as WebKitDeviceOrientationEvent;
        if (forceAbsolute) {
          this.sawAbsoluteEvent = true;
        } else if (this.sawAbsoluteEvent && typeof event.webkitCompassHeading !== 'number') {
          // Avoid double-processing when Chromium fires both deviceorientationabsolute and deviceorientation.
          return;
        }
        const now = Date.now();
        const updated = this.estimator.ingestOrientation({
          alpha: event.alpha,
          beta: event.beta,
          gamma: event.gamma,
          absolute: forceAbsolute || event.absolute === true,
          webkitCompassHeading: event.webkitCompassHeading ?? null,
          webkitCompassAccuracy: event.webkitCompassAccuracy ?? null,
          screenAngleDeg: readScreenAngleDeg(),
          timestamp: now,
        });
        if (updated) this.emitIfChanged(now, false);
      };

      this.absoluteHandler = (event: Event) => handleEvent(event, true);
      this.orientationHandler = (event: Event) => handleEvent(event, false);
      this.target.addEventListener('deviceorientationabsolute', this.absoluteHandler);
      this.target.addEventListener('deviceorientation', this.orientationHandler);
    }

    this.watchdog = setInterval(() => {
      if (!this.active) return;
      const now = Date.now();
      if (this.estimator.checkFreshness(now)) {
        this.emitIfChanged(now, true);
      }
    }, 500);

    this.emitIfChanged(Date.now(), true);
  }

  stop() {
    this.active = false;
    if (this.absoluteHandler) {
      this.target.removeEventListener('deviceorientationabsolute', this.absoluteHandler);
      this.absoluteHandler = null;
    }
    if (this.orientationHandler) {
      this.target.removeEventListener('deviceorientation', this.orientationHandler);
      this.orientationHandler = null;
    }
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.estimator.reset();
    this.lastEmitted = null;
    this.lastEmitAt = -Infinity;
    this.onChange = null;
  }

  private emitIfChanged(now: number, force: boolean) {
    if (!this.onChange) return;
    const next = this.bearingToPlanAngle
      ? this.estimator.resolvePlanHeading(this.bearingToPlanAngle, this.pdrFallback, now)
      : null;

    if (!force && now - this.lastEmitAt < MIN_EMIT_INTERVAL_MS) {
      if ((this.lastEmitted === null) === (next === null)) return;
    }
    if (!force && !headingMateriallyChanged(this.lastEmitted, next)) return;
    if (force && !headingMateriallyChanged(this.lastEmitted, next) && this.lastEmitAt > -Infinity) {
      return;
    }

    this.lastEmitted = next;
    this.lastEmitAt = now;
    this.onChange(next);
  }
}
