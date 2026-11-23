// @vitest-environment jsdom
/** Hook lifecycle tests in an in-memory DOM, without a browser or screen checks. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  usePhotoDeviceLocation,
  useWalkingLocation,
  WATCH_STALL_RESTART_MS,
} from '../src/location/use-device-location';
import { position } from './location-fixtures';

let walking: ReturnType<typeof useWalkingLocation>;
let photo: ReturnType<typeof usePhotoDeviceLocation>;
let root: Root;
let host: HTMLDivElement;
let watchSuccess: PositionCallback;
let watchError: PositionErrorCallback;
let watchCount = 0;
let onceSuccess: PositionCallback[];
const clearWatch = vi.fn();
const permission = new EventTarget() as EventTarget & { state: string };
function Harness() {
  walking = useWalkingLocation();
  photo = usePhotoDeviceLocation();
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('isSecureContext', true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  permission.state = 'granted';
  onceSuccess = [];
  watchCount = 0;
  clearWatch.mockClear();
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) => onceSuccess.push(success),
      watchPosition: (success: PositionCallback, error?: PositionErrorCallback) => {
        watchSuccess = success;
        watchError = error ?? (() => {});
        watchCount += 1;
        return 8 + watchCount;
      },
      clearWatch,
    },
    permissions: { query: () => Promise.resolve(permission) },
  });
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('device evidence lifecycle', () => {
  it('keeps photo-associated evidence historical through slow inference and clears it on replacement', async () => {
    await act(async () => {
      void photo.capture().catch(() => undefined);
    });
    await act(async () => onceSuccess[0](position()));
    await act(async () => vi.advanceTimersByTimeAsync(90000));
    expect(photo.snapshot?.reading.timestamp).toBe(10000);
    expect(walking.reading).toBeUndefined();
    await act(async () => {
      void photo.capture().catch(() => undefined);
    });
    await act(async () => photo.clear());
    await act(async () => onceSuccess[1](position()));
    expect(photo.snapshot).toBeUndefined();
    expect(photo.status).toBe('');
  });
  it('ages walking evidence without callbacks, resumes with a new reading and discards hidden-page callbacks', async () => {
    await act(async () => walking.start());
    const old = watchSuccess;
    await act(async () => watchSuccess(position()));
    expect(walking.fresh).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(walking.fresh).toBe(false);
    expect(walking.reading?.timestamp).toBe(10000);
    await act(async () => watchSuccess(position()));
    expect(walking.fresh).toBe(true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(walking.active).toBe(false);
    expect(clearWatch).toHaveBeenCalledWith(9);
    await act(async () => old(position()));
    expect(walking.reading?.timestamp).toBe(12500);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await act(async () => walking.start());
    expect(walking.reading).toBeUndefined();
    await act(async () => watchSuccess(position()));
    expect(walking.fresh).toBe(true);
  });
  it('stops for permission revocation and invalidates pending photo work on page hide', async () => {
    await act(async () => walking.start());
    permission.state = 'denied';
    await act(async () => permission.dispatchEvent(new Event('change')));
    expect(walking.active).toBe(false);
    expect(walking.status).toContain('revoked');
    await act(async () => {
      void photo.capture().catch(() => undefined);
    });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => onceSuccess[0](position()));
    expect(photo.snapshot).toBeUndefined();
    expect(photo.status).toContain('paused');
  });
  it('clears the foreground watch on unmount', async () => {
    await act(async () => walking.start());
    await act(async () => root.unmount());
    expect(clearWatch).toHaveBeenCalledWith(9);
    await act(async () => watchSuccess(position()));
  });
  it('cancels pending photo acquisition before the visitor starts walking', async () => {
    await act(async () => {
      void photo.capture().catch(() => undefined);
    });
    await act(async () => photo.cancelPending());
    await act(async () => walking.start());
    await act(async () => onceSuccess[0](position()));
    expect(photo.snapshot).toBeUndefined();
    expect(photo.status).toContain('timed out');
    await act(async () => watchSuccess(position()));
    expect(walking.fresh).toBe(true);
  });
  it('quietly restarts a stalled or timed-out watch without clearing the reading or replaying older timestamps', async () => {
    await act(async () => walking.start());
    expect(watchCount).toBe(1);
    await act(async () => watchSuccess(position(10000)));
    expect(walking.reading?.timestamp).toBe(10000);

    // Silence for WATCH_STALL_RESTART_MS restarts the watch while preserving the last reading.
    await act(async () => vi.advanceTimersByTimeAsync(WATCH_STALL_RESTART_MS));
    expect(watchCount).toBe(2);
    expect(clearWatch).toHaveBeenCalledWith(9);
    expect(walking.reading?.timestamp).toBe(10000);

    // Older timestamp from before the restart is ignored; newer indoor fix is accepted.
    await act(async () => watchSuccess(position(10000)));
    expect(walking.reading?.timestamp).toBe(10000);
    await act(async () => watchSuccess(position(22000)));
    expect(walking.reading?.timestamp).toBe(22000);

    // Transient TIMEOUT error restarts quietly once cooldown elapses without setting an error status.
    await act(async () => vi.advanceTimersByTimeAsync(WATCH_STALL_RESTART_MS));
    const countBeforeTimeout = watchCount;
    await act(async () => vi.advanceTimersByTimeAsync(WATCH_STALL_RESTART_MS));
    await act(async () => watchError({ code: 3 } as GeolocationPositionError));
    expect(watchCount).toBeGreaterThanOrEqual(countBeforeTimeout + 1);
    expect(walking.status).toBe('');

    // Permission denial stops permanently and never restarts on later timer ticks.
    await act(async () => watchError({ code: 1 } as GeolocationPositionError));
    const countAfterDeny = watchCount;
    await act(async () => vi.advanceTimersByTimeAsync(WATCH_STALL_RESTART_MS * 2));
    expect(watchCount).toBe(countAfterDeny);
    expect(walking.active).toBe(false);
  });

  it('ignores a replay of a skewed fix across an immediate watch restart', async () => {
    await act(async () => walking.start());
    await act(async () => watchSuccess(position(10800)));
    const original = walking.reading;
    expect(original).toMatchObject({ timestamp: 10000, captureTimestamp: 10800 });

    await act(async () => vi.advanceTimersByTimeAsync(400));
    await act(async () => watchError({ code: 3 } as GeolocationPositionError));
    expect(watchCount).toBe(2);
    await act(async () => watchSuccess(position(10800)));
    await act(async () => watchSuccess(position(10700)));
    expect(walking.reading).toBe(original);

    await act(async () => watchSuccess(position(10900)));
    expect(walking.reading).toMatchObject({ timestamp: 10400, captureTimestamp: 10900 });
  });
});
