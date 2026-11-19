/** Deterministic permission, cancellation and sample ordering tests. No physical device is used. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserLocation, LOCATION_OPTIONS } from '../src/location/browser-location';
import { position } from './location-fixtures';
describe('foreground browser location adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    vi.stubGlobal('isSecureContext', true);
  });
  afterEach(() => {
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
      getCurrentPosition: (success: PositionCallback, _failure: PositionErrorCallback, options: PositionOptions) =>
        requests.push({ success, options }),
    } as unknown as Geolocation);
    const result = source.once();
    await vi.advanceTimersByTimeAsync(9000);
    requests[0].success(position(5000));
    expect(requests).toHaveLength(2);
    expect(requests[1].options).toMatchObject({maximumAge: 0, timeout: 6000});
    requests[1].success(position(Date.now()));
    await expect(result).resolves.toMatchObject({timestamp: 19000});
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
});
