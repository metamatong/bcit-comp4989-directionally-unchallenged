/** One absolute deadline covers preparation, attempts and backoff for an API stage. */
import type { GenerationOptions } from './provider';

export function stageDeadline(durationMs: number, cancellation?: AbortSignal) {
  const deadlineAt = Date.now() + durationMs;
  const deadline = AbortSignal.timeout(durationMs);
  return {
    deadlineAt,
    signal: cancellation ? AbortSignal.any([cancellation, deadline]) : deadline,
  };
}

export function remainingRequestMs(options: GenerationOptions, fallbackMs: number) {
  const remaining = options.deadlineAt === undefined ? fallbackMs : options.deadlineAt - Date.now();
  return Math.max(1, Math.ceil(Math.min(remaining, options.timeoutMs ?? remaining)));
}

export function canRetryBeforeDeadline(deadlineAt: number, pauseMs: number) {
  return pauseMs <= 8000 && deadlineAt - Date.now() > pauseMs + 1000;
}
