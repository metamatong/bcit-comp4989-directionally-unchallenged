/** One foreground watch or one-shot acquisition, with bounded lifetime and late-callback guards. */
import type { DeviceReading } from './types';

export const LOCATION_FRESH_MS = 2000;
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
    onReading: (reading: DeviceReading) => void,
    onError: (message: string, denied: boolean) => void,
  ) {
    this.stop();
    const generation = this.generation;
    let latest = -Infinity;
    try {
      this.watchId = this.available().watchPosition(
        (position) => {
          if (this.generation !== generation) return;
          const reading = toReading(position);
          if (eligibleReading(reading) && reading.timestamp > latest) {
            latest = reading.timestamp;
            onReading(reading);
          }
        },
        (error) => {
          if (this.generation !== generation) return;
          if (error.code === 1) this.stop();
          onError(errorMessage(error), error.code === 1);
        },
        LOCATION_OPTIONS,
      );
    } catch (error) {
      onError((error as Error).message, true);
    }
  }
}
