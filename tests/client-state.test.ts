import { describe, expect, it, vi } from 'vitest';
import { ApiError, clearLegacyModePreference, readPhotoInSession, RequestGate } from '../src/api';
import { newSession } from '../server/session';

describe('removed preferences and transient evidence', () => {
  it('renews an expired photo session once and runs the workflow using the new session', async () => {
    const initial = newSession(),
      fresh = newSession();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('expired', undefined, 404))
      .mockResolvedValueOnce('complete');
    const renew = vi.fn().mockResolvedValue(fresh);
    await expect(
      readPhotoInSession(initial, run, renew, new AbortController().signal),
    ).resolves.toBe('complete');
    expect(run.mock.calls.map(([session]) => session.id)).toEqual([initial.id, fresh.id]);
    expect(renew).toHaveBeenCalledTimes(1);
  });
  it('never resubmits after a provider failure or a photo cancellation', async () => {
    const initial = newSession(),
      renew = vi.fn();
    const timeout = new ApiError('Gemini timed out', initial, 504);
    await expect(
      readPhotoInSession(
        initial,
        async () => {
          throw timeout;
        },
        renew,
        new AbortController().signal,
      ),
    ).rejects.toBe(timeout);
    const controller = new AbortController(),
      run = vi.fn().mockRejectedValue(new ApiError('expired', undefined, 404));
    await expect(
      readPhotoInSession(
        initial,
        run,
        async () => {
          controller.abort();
          return newSession();
        },
        controller.signal,
      ),
    ).rejects.toBeDefined();
    expect(renew).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('clears the obsolete browser mode without storing a replacement preference', () => {
    const storage = { removeItem: vi.fn() };
    clearLegacyModePreference(storage);
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith('directionallyunchallenged.ai-mode');
  });
  it('works when browser storage is blocked', () => {
    expect(() =>
      clearLegacyModePreference({
        removeItem: () => {
          throw new Error('denied');
        },
      }),
    ).not.toThrow();
  });
  it('discards older photo work after a replacement or cancellation', () => {
    const gate = new RequestGate();
    const first = gate.next();
    const next = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(next)).toBe(true);
    gate.cancel();
    expect(gate.isCurrent(next)).toBe(false);
  });
  it('uses provider readiness only for status, with no synthetic fallback state', () => {
    for (const configured of [true, false]) {
      const session = newSession(configured);
      expect(session.mode).toBe('live');
      expect(session.campusLocation).toBeNull();
      expect(session.activity).toEqual([]);
      expect(session).not.toHaveProperty('route');
      expect(session).not.toHaveProperty('replayStage');
    }
  });
});
