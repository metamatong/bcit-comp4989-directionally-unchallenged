/** Foreground orientation events, AbsoluteOrientationSensor support, and throttled facing-cone updates. */
import { getOrientationPermissionState, isOrientationSupported } from './browser-motion';
import {
  extractMagneticBearingRad,
  extractQuaternionMagneticBearingRad,
  HeadingEstimator,
  wrapAngleRad,
  type CompassBearing,
} from './heading';
import type { DeviceHeading } from './types';

type WebKitDeviceOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type AbsoluteOrientationSensorLike = EventTarget & {
  readonly quaternion?: readonly [number, number, number, number] | null;
  start: () => void;
  stop: () => void;
};

type AbsoluteOrientationSensorCtor = new (options?: {
  frequency?: number;
  referenceFrame?: 'device' | 'screen';
}) => AbsoluteOrientationSensorLike;

type OrientationSource = 'sensor' | 'webkit' | 'absolute-event' | 'absolute';

const MIN_EMIT_INTERVAL_MS = 75;
const MIN_EMIT_DELTA_RAD = (3 * Math.PI) / 180;
const ORIENTATION_SENSOR_FREQUENCY_HZ = 15;

/** Maximum age of a foreground pre-warmed compass bearing eligible for Step 1 handoff. */
export const HEADING_PREWARM_MAX_AGE_MS = 15_000;

function readScreenAngleDeg(): number {
  const angle = globalThis.screen?.orientation?.angle;
  if (typeof angle === 'number' && Number.isFinite(angle)) return angle;
  const legacy = (globalThis as { orientation?: unknown }).orientation;
  return typeof legacy === 'number' && Number.isFinite(legacy) ? legacy : 0;
}

function absoluteOrientationSensorConstructor(): AbsoluteOrientationSensorCtor | undefined {
  if (!globalThis.isSecureContext) return undefined;
  const ctor = (
    globalThis as { AbsoluteOrientationSensor?: AbsoluteOrientationSensorCtor }
  ).AbsoluteOrientationSensor;
  return typeof ctor === 'function' ? ctor : undefined;
}

/**
 * Shared low-level foreground orientation reader.
 * Starts Chrome's AbsoluteOrientationSensor (when available) alongside passive
 * deviceorientationabsolute / deviceorientation fallbacks, locking source priority once a
 * higher-priority stream emits a valid reading so sources never flap or double-feed.
 */
class OrientationStream {
  private source: OrientationSource | null = null;
  private sawOrientationSensor = false;
  private sawDedicatedAbsolute = false;
  private sensor: AbsoluteOrientationSensorLike | null = null;
  private onReading:
    | ((reading: CompassBearing | null, source: OrientationSource, sourceChanged: boolean) => void)
    | null = null;

  constructor(private readonly target: EventTarget = window) {}

  seedSource(source: OrientationSource) {
    // Track the cached bearing's source so an invalid sample from it can clear the cone.
    // Only a valid live reading earns priority over other sources.
    this.source = source;
  }

  start(
    onReading: (
      reading: CompassBearing | null,
      source: OrientationSource,
      sourceChanged: boolean,
    ) => void,
  ) {
    this.stop();
    this.onReading = onReading;
    this.startAbsoluteOrientationSensor();
    this.target.addEventListener('deviceorientationabsolute', this.handleOrientation);
    this.target.addEventListener('deviceorientation', this.handleOrientation);
  }

  stop() {
    this.stopAbsoluteOrientationSensor();
    this.target.removeEventListener('deviceorientationabsolute', this.handleOrientation);
    this.target.removeEventListener('deviceorientation', this.handleOrientation);
    this.source = null;
    this.sawOrientationSensor = false;
    this.sawDedicatedAbsolute = false;
    this.onReading = null;
  }

  private startAbsoluteOrientationSensor() {
    const SensorCtor = absoluteOrientationSensorConstructor();
    if (!SensorCtor) return;
    try {
      const sensor = new SensorCtor({
        frequency: ORIENTATION_SENSOR_FREQUENCY_HZ,
        referenceFrame: 'device',
      });
      this.sensor = sensor;
      sensor.addEventListener('reading', this.handleSensorReading);
      sensor.addEventListener('error', this.handleSensorError);
      sensor.start();
    } catch {
      this.stopAbsoluteOrientationSensor();
    }
  }

  private stopAbsoluteOrientationSensor() {
    if (!this.sensor) return;
    const sensor = this.sensor;
    this.sensor = null;
    sensor.removeEventListener('reading', this.handleSensorReading);
    sensor.removeEventListener('error', this.handleSensorError);
    try {
      sensor.stop();
    } catch {
      /* Ignore stop errors from unstarted or revoked sensor instances. */
    }
  }

  private deliver(source: OrientationSource, reading: CompassBearing | null) {
    if (!this.onReading) return;
    // An unavailable event from another source says nothing about our current bearing.
    if (!reading && this.source !== source) return;
    if (source === 'sensor' && reading) {
      this.sawOrientationSensor = true;
    } else if (source === 'absolute-event' && reading) {
      this.sawDedicatedAbsolute = true;
    }
    const sourceChanged = Boolean(reading && this.source !== null && this.source !== source);
    this.source = reading ? source : null;
    this.onReading(reading, source, sourceChanged);
  }

  private handleSensorReading = () => {
    const quaternion = this.sensor?.quaternion ?? null;
    const reading = extractQuaternionMagneticBearingRad({
      quaternion,
      screenAngleDeg: readScreenAngleDeg(),
    });
    this.deliver('sensor', reading);
  };

  private handleSensorError = () => {
    const wasActiveSource = this.source === 'sensor';
    this.stopAbsoluteOrientationSensor();
    this.sawOrientationSensor = false;
    if (wasActiveSource) {
      this.deliver('sensor', null);
    }
  };

  private handleOrientation = (rawEvent: Event) => {
    // Once AbsoluteOrientationSensor has produced a valid reading, avoid double-feeding or flapping.
    if (this.sawOrientationSensor) return;

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
    } else if (event.absolute === true && !this.sawDedicatedAbsolute) {
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
    this.deliver(source, reading);
  };
}

type PrewarmedBearing = {
  reading: CompassBearing;
  source: OrientationSource;
  timestamp: number;
};

let prewarmStream: OrientationStream | null = null;
let prewarmedBearing: PrewarmedBearing | null = null;

/**
 * Start foreground orientation pre-warming while permission is already granted (e.g. Android Chrome
 * on the destination / analysis screens) so magnetometer fusion converges before Step 1 opens.
 */
export function startHeadingPrewarm() {
  if (prewarmStream) return;
  if (
    !isOrientationSupported() ||
    getOrientationPermissionState() !== 'granted' ||
    (typeof document !== 'undefined' && document.hidden)
  ) {
    return;
  }

  const stream = new OrientationStream(window);
  prewarmStream = stream;
  prewarmedBearing = null;
  stream.start((reading, source) => {
    if (prewarmStream !== stream) return;
    if (reading) {
      prewarmedBearing = { reading, source, timestamp: Date.now() };
    } else {
      prewarmedBearing = null;
    }
  });
}

/** Stop foreground orientation pre-warming and discard any transient cached bearing. */
export function stopHeadingPrewarm() {
  if (prewarmStream) {
    const stream = prewarmStream;
    prewarmStream = null;
    stream.stop();
  }
  prewarmedBearing = null;
}

/** Consume a fresh pre-warmed bearing once when GuidedDirections starts live heading tracking. */
function consumePrewarmedBearing(now: number): PrewarmedBearing | null {
  const candidate = prewarmedBearing;
  prewarmedBearing = null;
  if (!candidate) return null;
  if (now < candidate.timestamp || now - candidate.timestamp > HEADING_PREWARM_MAX_AGE_MS) {
    return null;
  }
  return candidate;
}

export function resetHeadingPrewarmForTests() {
  stopHeadingPrewarm();
}

export class BrowserHeading {
  private readonly estimator = new HeadingEstimator();
  private readonly stream: OrientationStream;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private onChange: ((heading: DeviceHeading | null) => void) | null = null;
  private lastEmitted: DeviceHeading | null = null;
  private lastEmitAt = -Infinity;

  constructor(
    private readonly bearingToPlanAngle: (trueBearingRad: number) => number,
    private readonly target: EventTarget = window,
  ) {
    this.stream = new OrientationStream(target);
  }

  ingestGyroYaw(omegaCcwRadPerSec: number, timestamp: number) {
    if (!this.onChange) return;
    this.estimator.ingestGyroYaw(omegaCcwRadPerSec, timestamp);
    this.emitIfChanged(timestamp);
  }

  start(onChange: (heading: DeviceHeading | null) => void) {
    this.stop();
    if (!isOrientationSupported() || getOrientationPermissionState() !== 'granted') return;

    this.onChange = onChange;
    this.stream.start((reading, _source, sourceChanged) => {
      if (sourceChanged) {
        this.estimator.reset();
      }
      const now = Date.now();
      this.estimator.ingestCompass(reading, now);
      this.emitIfChanged(now);
    });
    this.watchdog = setInterval(() => this.emitIfChanged(Date.now()), 250);

    // One-shot handoff from foreground pre-warming so Step 1 can render the cone immediately.
    if (this.target === window) {
      const now = Date.now();
      const prewarmed = consumePrewarmedBearing(now);
      if (prewarmed) {
        this.stream.seedSource(prewarmed.source);
        this.estimator.ingestCompass(prewarmed.reading, prewarmed.timestamp);
        this.emitIfChanged(now);
      }
    }
  }

  stop() {
    this.stream.stop();
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.estimator.reset();
    this.lastEmitted = null;
    this.lastEmitAt = -Infinity;
    this.onChange = null;
  }

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
