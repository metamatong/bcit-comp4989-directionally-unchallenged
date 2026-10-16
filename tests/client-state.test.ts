import { describe, expect, it, vi } from 'vitest';
import { clearLegacyModePreference, RequestGate } from '../src/api';
import { newSession } from '../server/session';

describe('removed preferences and transient evidence', () => {
  it('clears the obsolete browser mode without storing a replacement preference', () => {
    const storage = { removeItem: vi.fn() };
    clearLegacyModePreference(storage);
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith('campuslens.ai-mode');
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
      expect(session.activity).toEqual([]);
      expect(session).not.toHaveProperty('route');
      expect(session).not.toHaveProperty('replayStage');
    }
  });
});
