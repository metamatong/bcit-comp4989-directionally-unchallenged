/** Deterministic permission, cancellation and sample ordering tests. No physical device is used. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserLocation,
  consumePrewarmedLocation,
  LOCATION_OPTIONS,
  peekFreshPrewarmedLocation,
  resetLocationPrewarmForTests,
  seedPrewarmedLocationFromCapture,
  startLocationPrewarm,
  stopLocationPrewarm,
} from '../src/location/browser-location';
import { position } from './location-fixtures';
describe('foreground browser location adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    vi.stubGlobal('isSecureContext', true);
  });
  afterEach(() => {
    resetLocationPrewarmForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('uses high accuracy with zero cached age and cancels older one-shot work', async () => {
    const requests: PositionCallback[] = [];
    const getCurrentPosition = vi.fn(
      (success: PositionCallback, _error: PositionErrorCallback, _options: PositionOptions) =>
        requests.push(success),
    );
    const source = new BrowserLocation({ getCurrentPosition } as unknown as Geolocation);
    const first = source.once();
    const cancelled = expect(first).rejects.toThrow('cancelled');
    source.stop();
    await cancelled;
    const second = source.once();
    requests[0](position());
    requests[1](position());
    await expect(second).resolves.toMatchObject({ timestamp: 10000, receivedAt: 10000 });
    expect(getCurrentPosition.mock.calls[0][2]).toEqual(LOCATION_OPTIONS);
  });
  it('bounds waiting for permission and ignores callbacks after timeout', async () => {
    let callback: PositionCallback = () => {};
    const source = new BrowserLocation({
      getCurrentPosition: (success: PositionCallback) => {
        callback = success;
      },
    } as Geolocation);
    const result = source.once();
    const failure = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    callback(position());
  });
  it('rejects stale one-shot readings and insecure contexts', async () => {
    const source = new BrowserLocation({
      getCurrentPosition: (success: PositionCallback) => success(position(5000)),
    } as Geolocation);
    await expect(source.once()).rejects.toThrow('old or invalid');
    vi.stubGlobal('isSecureContext', false);
    await expect(source.once()).rejects.toThrow('HTTPS');
  });
  it('recovers a fresh building reading after a stale first fix without extending the deadline', async () => {
    const requests: { success: PositionCallback; options?: PositionOptions }[] = [];
    const source = new BrowserLocation({
      getCurrentPosition: (
        success: PositionCallback,
        _failure: PositionErrorCallback,
        options: PositionOptions,
      ) => requests.push({ success, options }),
    } as unknown as Geolocation);
    const result = source.once();
    await vi.advanceTimersByTimeAsync(9000);
    requests[0].success(position(5000));
    expect(requests).toHaveLength(2);
    expect(requests[1].options).toMatchObject({ maximumAge: 0, timeout: 6000 });
    requests[1].success(position(Date.now()));
    await expect(result).resolves.toMatchObject({ timestamp: 19000 });
  });
  it('retains the latest eligible reading and ignores queued callbacks after stop or revocation', () => {
    let success: PositionCallback = () => {},
      failure: PositionErrorCallback = () => {};
    const clearWatch = vi.fn();
    const source = new BrowserLocation({
      getCurrentPosition: vi.fn(),
      watchPosition: (a: PositionCallback, b: PositionErrorCallback) => {
        success = a;
        failure = b;
        return 7;
      },
      clearWatch,
    });
    const onReading = vi.fn(),
      onError = vi.fn();
    source.start(onReading, onError);
    success(position(10000));
    success(position(9999));
    success(position(10000));
    success(position(5000));
    expect(onReading).toHaveBeenCalledTimes(1);
    failure({ code: 1 } as GeolocationPositionError);
    success(position());
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('denied'), true);
    expect(onReading).toHaveBeenCalledTimes(1);
  });
  it('accepts recent indoor fixes and deduplicates by browser capture time before clamping', () => {
    let success: PositionCallback = () => {},
      failure: PositionErrorCallback = () => {};
    const source = new BrowserLocation({
      getCurrentPosition: vi.fn(),
      watchPosition: (a: PositionCallback, b: PositionErrorCallback) => {
        success = a;
        failure = b;
        return 11;
      },
      clearWatch: vi.fn(),
    });
    const onReading = vi.fn();
    const onError = vi.fn();
    const onTimeout = vi.fn();
    source.start(onReading, onError, { minCaptureTimestamp: 5000, onTimeout });

    // Stale > 8 s rejected; older than minTimestamp rejected; > 1 s future rejected.
    success(position(1999));
    success(position(4500));
    success(position(11001));
    expect(onReading).not.toHaveBeenCalled();

    // 4 s old indoor fix accepted.
    success(position(6000));
    expect(onReading).toHaveBeenLastCalledWith(
      expect.objectContaining({ timestamp: 6000, receivedAt: 10000 }),
    );

    // +300 ms forward GNSS clock skew clamped to receivedAt (10000).
    success(position(10300));
    expect(onReading).toHaveBeenLastCalledWith(
      expect.objectContaining({ timestamp: 10000, receivedAt: 10000, captureTimestamp: 10300 }),
    );
    expect(onReading).toHaveBeenCalledTimes(2);

    vi.setSystemTime(10200);
    success(position(10300));
    success(position(10250));
    expect(onReading).toHaveBeenCalledTimes(2);
    success(position(10400));
    success(position(10500));
    expect(onReading).toHaveBeenCalledTimes(4);
    expect(onReading).toHaveBeenLastCalledWith(
      expect.objectContaining({ timestamp: 10200, captureTimestamp: 10500 }),
    );

    // Timeout (code 3) invokes onTimeout instead of onError.
    failure({ code: 3 } as GeolocationPositionError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('pre-warms silently once geolocation permission changes from prompt to granted', async () => {
    const watchPosition = vi.fn((success: PositionCallback) => {
      lastWatchSuccess = success;
      return 42;
    });
    const clearWatch = vi.fn();
    let lastWatchSuccess: PositionCallback | null = null;
    const perm = Object.assign(new EventTarget(), { state: 'prompt' as PermissionState });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: vi.fn(), watchPosition, clearWatch },
      permissions: { query: vi.fn().mockResolvedValue(perm) },
    });

    // Under 'prompt', pre-warming stays silent and never calls watchPosition.
    await startLocationPrewarm();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(peekFreshPrewarmedLocation(10000)).toBeNull();

    perm.state = 'granted';
    perm.dispatchEvent(new Event('change'));
    seedPrewarmedLocationFromCapture({
      latitude: 49.25,
      longitude: -123.0,
      accuracy: 8,
      timestamp: 10000,
      receivedAt: 10000,
    });
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(peekFreshPrewarmedLocation(11500)).toMatchObject({ timestamp: 10000, accuracy: 8 });
    // Strict 2 s freshness check for Get Directions reuse, while 8 s window still qualifies for Step 1 handoff.
    expect(peekFreshPrewarmedLocation(12500)).toBeNull();
    expect(consumePrewarmedLocation(15000)).toMatchObject({
      timestamp: 10000,
      captureTimestamp: 10000,
    });
    // One-shot consumption clears the handoff slot.
    expect(consumePrewarmedLocation(15000)).toBeNull();

    // Subsequent watch fix refreshes the cache; stop clears watch and reading.
    vi.setSystemTime(16000);
    lastWatchSuccess!(position(16000));
    expect(peekFreshPrewarmedLocation(16000)).toMatchObject({ timestamp: 16000 });
    stopLocationPrewarm();
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(consumePrewarmedLocation(16000)).toBeNull();
  });

  it.each(['prompt', 'denied'] as const)(
    'clears the watch and cached fix when permission becomes %s',
    async (state) => {
      let nextWatchId = 0;
      const watchPosition = vi.fn((_success: PositionCallback) => ++nextWatchId);
      const clearWatch = vi.fn();
      const permission = Object.assign(new EventTarget(), { state: 'granted' as PermissionState });
      vi.stubGlobal('navigator', {
        geolocation: { watchPosition, clearWatch },
        permissions: { query: vi.fn().mockResolvedValue(permission) },
      });

      await startLocationPrewarm();
      const [firstFix] = watchPosition.mock.calls[0];
      firstFix(position(10000));
      expect(peekFreshPrewarmedLocation()).toMatchObject({ timestamp: 10000 });

      permission.state = state;
      expect(peekFreshPrewarmedLocation()).toBeNull();
      permission.dispatchEvent(new Event('change'));
      expect(clearWatch).toHaveBeenCalledWith(1);
      expect(watchPosition).toHaveBeenCalledTimes(1);

      permission.state = 'granted';
      permission.dispatchEvent(new Event('change'));
      expect(watchPosition).toHaveBeenCalledTimes(2);
      firstFix(position(10000));
      expect(consumePrewarmedLocation()).toBeNull();
      watchPosition.mock.calls[1][0](position(10000));
      expect(consumePrewarmedLocation()).toMatchObject({ captureTimestamp: 10000 });
    },
  );

  it.each(['unavailable', 'rejected'] as const)(
    'skips silent pre-warming when the permission query is %s after a capture',
    async (query) => {
      const permission = Object.assign(new EventTarget(), { state: 'granted' as PermissionState });
      const watchPosition = vi.fn(() => 1);
      const geolocation = {
        watchPosition,
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn((success: PositionCallback) => success(position(10000))),
      };
      vi.stubGlobal('navigator', {
        geolocation,
        permissions: { query: vi.fn().mockResolvedValue(permission) },
      });
      await startLocationPrewarm();
      seedPrewarmedLocationFromCapture(await new BrowserLocation().once());
      expect(peekFreshPrewarmedLocation()).toMatchObject({ timestamp: 10000 });
      stopLocationPrewarm();
      watchPosition.mockClear();

      vi.stubGlobal('navigator', {
        geolocation,
        permissions:
          query === 'rejected'
            ? { query: vi.fn().mockRejectedValue(Error('Unavailable')) }
            : undefined,
      });
      await startLocationPrewarm();
      seedPrewarmedLocationFromCapture(await new BrowserLocation().once());
      expect(watchPosition).not.toHaveBeenCalled();
      expect(peekFreshPrewarmedLocation()).toBeNull();
      expect(consumePrewarmedLocation()).toBeNull();
    },
  );
});
