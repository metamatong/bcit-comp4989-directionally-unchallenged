/** Short-lived, image-free visitor sessions and exclusive revision updates. */
import type { Session } from '../src/types';
import type { PhotoEvidenceRecord } from './photo-evidence';

export const sessionLifetimeMs = 30 * 60_000;
export const sessionCapacity = 200;
export type VisitorRecord = { session: Session; evidence?: PhotoEvidenceRecord };
export type SessionLease =
  | { busy: true; record: VisitorRecord }
  | { busy: false; record: VisitorRecord; finish: (updated?: VisitorRecord) => Promise<void> };
export interface VisitorSessions {
  create(session: Session): Promise<boolean>;
  read(id: string): Promise<VisitorRecord | undefined>;
  claim(id: string): Promise<SessionLease | undefined>;
}
export class SessionStorageError extends Error {
  constructor() {
    super('Session storage is temporarily unavailable. Please retry shortly.');
  }
}

export class MemoryVisitorSessions implements VisitorSessions {
  private records = new Map<string, VisitorRecord>();
  private locked = new Set<string>();

  constructor() {
    const cleanup = setInterval(() => this.prune(), 60_000);
    cleanup.unref();
  }

  private prune() {
    const now = Date.now();
    for (const [id, record] of this.records) {
      if (this.locked.has(id)) continue;
      if (now - record.session.lastTouched >= sessionLifetimeMs) this.records.delete(id);
      else if (record.evidence && Date.parse(record.evidence.evidence.expiresAt) <= now) {
        delete record.evidence;
        record.session.photoEvidence = null;
      }
    }
  }

  async create(session: Session) {
    this.prune();
    if (this.records.size >= sessionCapacity) return false;
    this.records.set(session.id, { session: structuredClone(session) });
    return true;
  }

  private current(id: string) {
    const record = this.records.get(id);
    if (
      record &&
      (this.locked.has(id) || Date.now() - record.session.lastTouched < sessionLifetimeMs)
    )
      return structuredClone(record);
    this.records.delete(id);
  }

  async read(id: string) {
    return this.current(id);
  }

  async claim(id: string): Promise<SessionLease | undefined> {
    const record = this.current(id);
    if (!record) return;
    if (this.locked.has(id)) return { busy: true, record };
    this.locked.add(id);
    return {
      busy: false,
      record,
      finish: async (updated) => {
        if (updated) this.records.set(id, structuredClone(updated));
        this.locked.delete(id);
      },
    };
  }
}
