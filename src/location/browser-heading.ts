/** Foreground orientation events and throttled facing-cone updates. */
import { getOrientationPermissionState, isOrientationSupported } from './browser-motion';
import { extractMagneticBearingRad, HeadingEstimator, wrapAngleRad } from './heading';
import type { DeviceHeading } from './types';

type WebKitDeviceOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type OrientationSource = 'webkit' | 'absolute-event' | 'absolute';

const MIN_EMIT_INTERVAL_MS = 75;
const MIN_EMIT_DELTA_RAD = (3 * Math.PI) / 180;

function readScreenAngleDeg(): number {
  const angle = globalThis.screen?.orientation?.angle;
  if (typeof angle === 'number' && Number.isFinite(angle)) return angle;
  const legacy = (globalThis as { orientation?: unknown }).orientation;
  return typeof legacy === 'number' && Number.isFinite(legacy) ? legacy : 0;
}

export class BrowserHeading {
  private readonly estimator = new HeadingEstimator();
  private source: OrientationSource | null = null;
  private sawDedicatedAbsolute = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private onChange: ((heading: DeviceHeading | null) => void) | null = null;
  private lastEmitted: DeviceHeading | null = null;
  private lastEmitAt = -Infinity;

  constructor(
    private readonly bearingToPlanAngle: (trueBearingRad: number) => number,
    private readonly target: EventTarget = window,
  ) {}

  ingestGyroYaw(omegaCcwRadPerSec: number, timestamp: number) {
    if (!this.onChange) return;
    this.estimator.ingestGyroYaw(omegaCcwRadPerSec, timestamp);
    this.emitIfChanged(timestamp);
  }

  start(onChange: (heading: DeviceHeading | null) => void) {
    this.stop();
    if (!isOrientationSupported() || getOrientationPermissionState() !== 'granted') return;

    this.onChange = onChange;
    this.target.addEventListener('deviceorientationabsolute', this.handleOrientation);
    this.target.addEventListener('deviceorientation', this.handleOrientation);
    this.watchdog = setInterval(() => this.emitIfChanged(Date.now()), 250);
  }

  stop() {
    this.target.removeEventListener('deviceorientationabsolute', this.handleOrientation);
    this.target.removeEventListener('deviceorientation', this.handleOrientation);
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.estimator.reset();
    this.source = null;
    this.sawDedicatedAbsolute = false;
    this.lastEmitted = null;
    this.lastEmitAt = -Infinity;
    this.onChange = null;
  }

  private handleOrientation = (rawEvent: Event) => {
    const event = rawEvent as WebKitDeviceOrientationEvent;
    const dedicatedAbsoluteEvent = event.type === 'deviceorientationabsolute';
    const webkit =
      !dedicatedAbsoluteEvent &&
      ('webkitCompassHeading' in event || 'webkitCompassAccuracy' in event);
    let source: OrientationSource;
    if (webkit) {
      source = 'webkit';
    } else if (dedicatedAbsoluteEvent) {
      source = 'absolute-event';
    } else if (
      event.absolute === true &&
      !this.sawDedicatedAbsolute &&
      this.source !== 'absolute-event'
    ) {
      // Prefer the dedicated event once observed so brief invalid samples never flap sources.
      source = 'absolute';
    } else {
      return;
    }

    const reading = extractMagneticBearingRad({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      absolute: !webkit,
      webkitCompassHeading: webkit ? event.webkitCompassHeading : undefined,
      webkitCompassAccuracy: webkit ? event.webkitCompassAccuracy : undefined,
      screenAngleDeg: readScreenAngleDeg(),
    });
    // An unavailable event from another source says nothing about our current bearing.
    if (!reading && this.source !== source) return;
    if (dedicatedAbsoluteEvent && reading) {
      this.sawDedicatedAbsolute = true;
    }
    if (reading && this.source !== null && this.source !== source) {
      this.estimator.reset();
    }
    this.source = reading ? source : null;

    const now = Date.now();
    this.estimator.ingestCompass(reading, now);
    this.emitIfChanged(now);
  };

  private emitIfChanged(now: number) {
    if (!this.onChange) return;

    const next = this.estimator.resolvePlanHeading(this.bearingToPlanAngle, now);
    const previous = this.lastEmitted;
    if (
      previous &&
      next &&
      previous.source === next.source &&
      previous.spreadDeg === next.spreadDeg
    ) {
      const turned =
        Math.abs(wrapAngleRad(next.angleRad - previous.angleRad)) >= MIN_EMIT_DELTA_RAD;
      if (!turned || now - this.lastEmitAt < MIN_EMIT_INTERVAL_MS) return;
    }
    if (!previous && !next) return;

    this.lastEmitted = next;
    this.lastEmitAt = now;
    this.onChange(next);
  }
}
