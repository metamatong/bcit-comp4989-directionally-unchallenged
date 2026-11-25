/** One foreground watch or one-shot acquisition, with bounded lifetime and late-callback guards. */
import type { DeviceReading, WalkingReading } from './types';

export const LOCATION_FRESH_MS = 2000;
/** Maximum capture age accepted on arrival for continuous live walking watches. */
export const WALKING_GPS_INGEST_MAX_AGE_MS = 8000;
/** Forward GNSS-vs-wall-clock skew tolerance for continuous live walking watches. */
export const WALKING_GPS_FUTURE_SKEW_MS = 1000;
export const LOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
export function eligibleReading(reading: DeviceReading, now = reading.receivedAt) {
  return (
    [
      reading.latitude,
      reading.longitude,
      reading.accuracy,
      reading.timestamp,
      reading.receivedAt,
    ].every(Number.isFinite) &&
    Math.abs(reading.latitude) <= 90 &&
    Math.abs(reading.longitude) <= 180 &&
    reading.accuracy >= 0 &&
    now - reading.timestamp >= 0 &&
    now - reading.timestamp <= LOCATION_FRESH_MS
  );
}
/** Clamp small forward skew for age checks while preserving the fix's original identity. */
function normalizeWatchReading(reading: DeviceReading): WalkingReading {
  const futureSkew = reading.timestamp - reading.receivedAt;
  return {
    ...reading,
    captureTimestamp: reading.timestamp,
    timestamp:
      futureSkew > 0 && futureSkew <= WALKING_GPS_FUTURE_SKEW_MS
        ? reading.receivedAt
        : reading.timestamp,
  };
}
export function eligibleWatchReading(
  reading: DeviceReading,
  now = reading.receivedAt,
  maxAgeMs = WALKING_GPS_INGEST_MAX_AGE_MS,
) {
  return (
    [
      reading.latitude,
      reading.longitude,
      reading.accuracy,
      reading.timestamp,
      reading.receivedAt,
    ].every(Number.isFinite) &&
    Math.abs(reading.latitude) <= 90 &&
    Math.abs(reading.longitude) <= 180 &&
    reading.accuracy >= 0 &&
    now - reading.timestamp >= 0 &&
    now - reading.timestamp <= maxAgeMs
  );
}
function toReading(position: GeolocationPosition): DeviceReading {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp,
    receivedAt: Date.now(),
  };
}
function errorMessage(error: GeolocationPositionError) {
  return (
    {
      1: 'Location permission was denied. Enable it in your browser settings to try again.',
      2: 'Device location is unavailable.',
      3: 'Device location timed out. Try again.',
    }[error.code] ?? 'Device location failed.'
  );
}
export class BrowserLocation {
  private watchId: number | null = null;
  private generation = 0;
  private cancelOnce?: () => void;
  constructor(private geolocation: Geolocation | undefined = navigator.geolocation) {}
  stop() {
    this.generation++;
    if (this.watchId !== null) this.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
    this.cancelOnce?.();
  }
  private available() {
    if (!globalThis.isSecureContext)
      throw Error('Device location requires HTTPS on a phone, or localhost on this computer.');
    if (!this.geolocation) throw Error('This browser does not support device location.');
    return this.geolocation;
  }
  once(): Promise<DeviceReading> {
    this.stop();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (reading?: DeviceReading, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelOnce = undefined;
        if (reading) resolve(reading);
        else reject(error);
      };
      // Browser timeout can exclude permission-dialog time. Bound our own pending operation too.
      const timer = setTimeout(
        () => finish(undefined, Error('Device location timed out. Try again.')),
        15000,
      );
      this.cancelOnce = () => finish(undefined, Error('Device location request cancelled.'));
      const deadline = Date.now() + LOCATION_OPTIONS.timeout;
      const request = (retryInvalid: boolean) => {
        if (settled) return;
        try {
          this.available().getCurrentPosition(
            (position) => {
              if (settled) return;
              const reading = toReading(position);
              if (eligibleReading(reading)) finish(reading);
              else if (retryInvalid && Date.now() < deadline) request(false);
              else
                finish(
                  undefined,
                  Error('The device returned an old or invalid reading. Try again.'),
                );
            },
            (error) => finish(undefined, Error(errorMessage(error))),
            { ...LOCATION_OPTIONS, timeout: Math.max(0, deadline - Date.now()) },
          );
        } catch (error) {
          finish(undefined, error as Error);
        }
      };
      // Some devices deliver a cached fix even for maximumAge: 0. Use the remaining one-shot budget.
      request(true);
    });
  }
  start(
    onReading: (reading: WalkingReading) => void,
    onError: (message: string, denied: boolean) => void,
    options?: { minCaptureTimestamp?: number; onTimeout?: () => void },
  ) {
    this.stop();
    const generation = this.generation;
    let latestCaptureTimestamp = options?.minCaptureTimestamp ?? -Infinity;
    try {
      this.watchId = this.available().watchPosition(
        (position) => {
          if (this.generation !== generation || position.timestamp <= latestCaptureTimestamp)
            return;
          const reading = normalizeWatchReading(toReading(position));
          if (eligibleWatchReading(reading)) {
            latestCaptureTimestamp = reading.captureTimestamp;
            onReading(reading);
          }
        },
        (error) => {
          if (this.generation !== generation) return;
          if (error.code === 1) this.stop();
          if (error.code === 3 && options?.onTimeout) {
            options.onTimeout();
            return;
          }
          onError(errorMessage(error), error.code === 1);
        },
        LOCATION_OPTIONS,
      );
    } catch (error) {
      onError((error as Error).message, true);
    }
  }
}

const PREWARM_WATCH_STALL_MS = 15_000;

let prewarmActive = false;
let prewarmGeneration = 0;
let prewarmLocation: BrowserLocation | null = null;
let prewarmedReading: WalkingReading | null = null;
let prewarmPermissionStatus: PermissionStatus | null = null;
let prewarmPermissionListener: (() => void) | null = null;
let prewarmStallTimer: ReturnType<typeof setInterval> | null = null;

function stopPrewarmWatch() {
  if (prewarmLocation) {
    prewarmLocation.stop();
    prewarmLocation = null;
  }
  if (prewarmStallTimer !== null) {
    clearInterval(prewarmStallTimer);
    prewarmStallTimer = null;
  }
  prewarmedReading = null;
}

function detachPrewarmPermissionListener() {
  if (prewarmPermissionStatus && prewarmPermissionListener) {
    prewarmPermissionStatus.removeEventListener('change', prewarmPermissionListener);
  }
  prewarmPermissionStatus = null;
  prewarmPermissionListener = null;
}

function canUseLocationPrewarm() {
  return (
    prewarmActive &&
    prewarmPermissionStatus?.state === 'granted' &&
    (typeof document === 'undefined' || !document.hidden)
  );
}

function beginPrewarmWatch(gen: number) {
  if (!canUseLocationPrewarm() || prewarmGeneration !== gen || prewarmLocation) return;

  let latestCaptureTimestamp = prewarmedReading?.captureTimestamp ?? -Infinity;
  let lastFixOrStartAt = Date.now();
  let lastRecoveryRestartAt = -Infinity;
  const location = new BrowserLocation();
  prewarmLocation = location;
  const isCurrentWatch = () => prewarmGeneration === gen && prewarmLocation === location;

  const startWatch = () => {
    if (!isCurrentWatch() || !canUseLocationPrewarm()) return;
    location.start(
      (next) => {
        if (!isCurrentWatch() || !canUseLocationPrewarm()) return;
        latestCaptureTimestamp = next.captureTimestamp;
        lastFixOrStartAt = Date.now();
        prewarmedReading = next;
      },
      (_message, denied) => {
        if (isCurrentWatch() && denied) stopPrewarmWatch();
      },
      {
        minCaptureTimestamp: latestCaptureTimestamp,
        onTimeout: () => {
          if (!isCurrentWatch() || !canUseLocationPrewarm()) return;
          const tickNow = Date.now();
          if (tickNow - lastRecoveryRestartAt >= PREWARM_WATCH_STALL_MS) {
            lastRecoveryRestartAt = tickNow;
            lastFixOrStartAt = tickNow;
            startWatch();
          }
        },
      },
    );
  };

  prewarmStallTimer = setInterval(() => {
    if (!isCurrentWatch() || !canUseLocationPrewarm()) return;
    const tickNow = Date.now();
    if (
      tickNow - lastFixOrStartAt >= PREWARM_WATCH_STALL_MS &&
      tickNow - lastRecoveryRestartAt >= PREWARM_WATCH_STALL_MS
    ) {
      lastRecoveryRestartAt = tickNow;
      lastFixOrStartAt = tickNow;
      startWatch();
    }
  }, 5000);
  startWatch();
}

/** Start silent foreground GPS pre-warming only with a verified current permission grant. */
export async function startLocationPrewarm() {
  if (prewarmActive) return;
  if (
    !globalThis.isSecureContext ||
    !navigator.geolocation ||
    typeof navigator.permissions?.query !== 'function' ||
    (typeof document !== 'undefined' && document.hidden)
  ) {
    return;
  }

  prewarmActive = true;
  const gen = ++prewarmGeneration;
  let status: PermissionStatus;
  try {
    status = await navigator.permissions.query({ name: 'geolocation' });
  } catch {
    return;
  }
  if (!prewarmActive || prewarmGeneration !== gen) return;

  prewarmPermissionStatus = status;
  const syncPermission = () => {
    if (!prewarmActive || prewarmGeneration !== gen) return;
    if (status.state === 'granted') beginPrewarmWatch(gen);
    else stopPrewarmWatch();
  };
  prewarmPermissionListener = syncPermission;
  status.addEventListener('change', syncPermission);
  syncPermission();
}

/** Stop foreground GPS pre-warming and discard any transient cached reading. */
export function stopLocationPrewarm() {
  prewarmActive = false;
  prewarmGeneration += 1;
  stopPrewarmWatch();
  detachPrewarmPermissionListener();
}

/** Cache the Get Directions fix when current permission permits pre-warming. */
export function seedPrewarmedLocationFromCapture(reading: DeviceReading) {
  if (!canUseLocationPrewarm()) return;
  const normalized = normalizeWatchReading(reading);
  if (
    eligibleWatchReading(normalized, Date.now()) &&
    (!prewarmedReading || normalized.captureTimestamp >= prewarmedReading.captureTimestamp)
  ) {
    prewarmedReading = normalized;
  }
  if (!prewarmLocation) {
    beginPrewarmWatch(prewarmGeneration);
  }
}

/**
 * Non-destructively reuse a pre-warmed reading for Get Directions only if it meets the
 * strict one-shot freshness threshold (<= LOCATION_FRESH_MS).
 */
export function peekFreshPrewarmedLocation(now = Date.now()): DeviceReading | null {
  if (!canUseLocationPrewarm() || !prewarmedReading) return null;
  if (!eligibleReading(prewarmedReading, now)) return null;
  const { latitude, longitude, accuracy, timestamp, receivedAt } = prewarmedReading;
  return { latitude, longitude, accuracy, timestamp, receivedAt };
}

/**
 * One-shot handoff of a fresh pre-warmed watch reading (<= WALKING_GPS_INGEST_MAX_AGE_MS)
 * when GuidedDirections mounts so Step 1 can show the live dot immediately.
 */
export function consumePrewarmedLocation(now = Date.now()): WalkingReading | null {
  const candidate = prewarmedReading;
  prewarmedReading = null;
  if (!canUseLocationPrewarm() || !candidate) return null;
  if (!eligibleWatchReading(candidate, now)) return null;
  return candidate;
}

export function resetLocationPrewarmForTests() {
  stopLocationPrewarm();
}
