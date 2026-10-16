import { randomUUID } from 'node:crypto';
import type { Session } from '../src/types';

export function newSession(providerAvailable = true): Session {
  return {
    id: randomUUID(),
    revision: 0,
    mode: 'live',
    activity: [],
    notice: providerAvailable
      ? 'Choose a photo to compare with official BCIT floor plans. Nothing is sent until you consent and select Analyze.'
      : 'Photo analysis needs Gemini setup. Configure the server and restart to enable analysis.',
    agentStatus: providerAvailable ? 'Gemini · ready' : 'Gemini · setup required',
    providerCalls: 0,
    lastTouched: Date.now(),
    appliedActions: [],
    photoEvidence: null,
    campusAnalysis: null,
  };
}

export function logActivity(
  session: Session,
  tool: string,
  summary: string,
  sourceRefs: string[] = [],
  durationMs?: number,
) {
  session.activity.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    tool,
    summary,
    sourceRefs,
    durationMs,
  });
  session.activity = session.activity.slice(-60);
}
