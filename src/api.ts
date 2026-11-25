import type { Bootstrap, Session } from './types';
import type { WalkingSurface } from './wayfinding';

/** Generate an RFC 4122 v4 UUID, including on plain HTTP where crypto.randomUUID is unavailable. */
export function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
const resolvedWalkingSurfaces = new Map<string, WalkingSurface>();

/** Synchronously return a previously fetched walking surface when already cached in memory. */
export function getCachedWalkingSurface(planId: string): WalkingSurface | undefined {
  return resolvedWalkingSurfaces.get(planId);
}

/** Kick off deduplicated background fetches for floor walking surfaces ahead of guided steps. */
export function prefetchWalkingSurfaces(planIds: Iterable<string>) {
  for (const planId of planIds) {
    if (planId && !resolvedWalkingSurfaces.has(planId) && !walkingSurfaces.has(planId)) {
      void fetchWalkingSurface(planId);
    }
  }
}

export function clearWalkingSurfaceCacheForTests() {
  walkingSurfaces.clear();
  resolvedWalkingSurfaces.clear();
}

/** Lazily load and cache public walkable corridor runs for client-side GPS map-matching. */
export async function fetchWalkingSurface(
  planId: string,
  signal?: AbortSignal,
): Promise<WalkingSurface | null> {
  const cached = resolvedWalkingSurfaces.get(planId);
  if (cached) return signal?.aborted ? null : cached;
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
        if (surface) resolvedWalkingSurfaces.set(planId, surface);
        else walkingSurfaces.delete(planId);
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
