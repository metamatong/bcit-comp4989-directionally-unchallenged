import type { Bootstrap, Session } from './types';
import type { WalkingSurface } from './wayfinding';

/** Remove obsolete preferences; provider readiness now comes only from the server. */
export function clearLegacyModePreference(storage?: Pick<Storage, 'removeItem'>) {
  try {
    (storage ?? window.localStorage).removeItem('directionallyunchallenged.ai-mode');
  } catch {
    // Blocked browser storage must not prevent starting a session.
  }
}
export class ApiError extends Error {
  constructor(
    message: string,
    public session?: Session,
    public httpStatus?: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 35000)])
        : AbortSignal.timeout(options?.timeoutMs ?? 35000),
    });
  } catch {
    throw new ApiError(
      'Connection lost or request timed out. Check your connection, then retry. Refresh the session before retrying.',
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      `The campus API returned an unreadable response (HTTP ${response.status}). Check the server deployment and try again.`,
      undefined,
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error ?? 'The request could not be completed.',
      data.session,
      response.status,
    );
  return data as T;
}
export const bootstrap = () => request<Bootstrap>('/api/bootstrap');
export const createSession = () => request<Session>('/api/sessions', {});

const walkingSurfaces = new Map<string, Promise<WalkingSurface | null>>();

/** Lazily load and cache public walkable corridor runs for client-side GPS map-matching. */
export async function fetchWalkingSurface(
  planId: string,
  signal?: AbortSignal,
): Promise<WalkingSurface | null> {
  let pending = walkingSurfaces.get(planId);
  if (!pending) {
    pending = request<WalkingSurface>(
      `/api/plans/${encodeURIComponent(planId)}/walking-surface`,
      undefined,
      { timeoutMs: 10000 },
    )
      .then((surface) =>
        surface && Array.isArray(surface.runs) && Number.isFinite(surface.step) ? surface : null,
      )
      .catch(() => null)
      .then((surface) => {
        if (!surface) walkingSurfaces.delete(planId);
        return surface;
      });
    walkingSurfaces.set(planId, pending);
  }
  const result = await pending;
  return signal?.aborted ? null : result;
}

/** A server restart can expire the session while the photo still exists in this tab. */
export async function readPhotoInSession<T>(
  current: Session,
  run: (session: Session) => Promise<T>,
  renew: () => Promise<Session>,
  signal: AbortSignal,
): Promise<T> {
  try {
    return await run(current);
  } catch (error) {
    if (!(error instanceof ApiError) || error.httpStatus !== 404 || signal.aborted) throw error;
    const fresh = await renew();
    signal.throwIfAborted();
    return run(fresh);
  }
}
/** Every capture gets a generation. Older asynchronous results cannot overwrite newer evidence. */
export class RequestGate {
  private generation = 0;
  next() {
    return ++this.generation;
  }
  isCurrent(value: number) {
    return value === this.generation;
  }
  cancel() {
    this.generation++;
  }
}
