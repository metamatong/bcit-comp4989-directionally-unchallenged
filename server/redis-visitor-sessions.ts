/** Redis leases make the two photo stages atomic across Vercel function instances. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Session } from '../src/types';
import type { PhotoEvidenceRecord } from './photo-evidence';
import { ProviderError } from './provider';
import {
  SessionStorageError,
  sessionCapacity,
  sessionLifetimeMs,
  type SessionLease,
  type VisitorRecord,
  type VisitorSessions,
} from './visitor-sessions';

type Command = (args: (string | number)[]) => Promise<unknown>;
export function redisRestCommand(url: string, token: string): Command {
  return async (args) => {
    try {
      if (!url.startsWith('https://') || !token) throw new SessionStorageError();
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new SessionStorageError();
      const data = await response.json();
      if (data.error || !Object.hasOwn(data, 'result')) throw new SessionStorageError();
      return data.result;
    } catch {
      throw new SessionStorageError();
    }
  };
}
const hash = (text: string) => createHash('sha256').update(text).digest();
// The random session ID is a bearer secret. Redis gets a separate lookup hash and ciphertext.
function seal(id: string, kind: 'session' | 'evidence', value: Session | PhotoEvidenceRecord) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', hash(kind + ':' + id), nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
}
function open<T>(id: string, kind: 'session' | 'evidence', value: unknown): T | undefined {
  if (typeof value !== 'string' || !value) return;
  try {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', hash(kind + ':' + id), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(),
    );
  } catch {
    throw new SessionStorageError();
  }
}
function unpack(id: string, state: unknown, observation: unknown): VisitorRecord | undefined {
  const session = open<Session>(id, 'session', state);
  if (!session) return;
  const evidence = open<PhotoEvidenceRecord>(id, 'evidence', observation);
  if (session.id !== id || (evidence && evidence.sessionId !== id)) throw new SessionStorageError();
  session.photoEvidence = evidence?.evidence ?? null;
  return { session, evidence };
}

const createScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 0 end
if not redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then return 0 end
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]) + tonumber(ARGV[2]), KEYS[1])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1`;
const claimScript = `
local state = redis.call('GET', KEYS[1])
if not state then return {0} end
local locked = redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2], 'NX')
return {state, locked and 1 or 0, redis.call('GET', KEYS[3]) or ''}`;
const finishScript = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
if ARGV[2] ~= '' then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  redis.call('ZADD', KEYS[3], ARGV[4], KEYS[1])
  redis.call('PEXPIRE', KEYS[3], ARGV[3])
  if ARGV[5] ~= '' and tonumber(ARGV[6]) > 0 then
    redis.call('SET', KEYS[4], ARGV[5], 'PX', ARGV[6])
  else
    redis.call('DEL', KEYS[4])
  end
end
redis.call('DEL', KEYS[2])
return 1`;

export class RedisVisitorSessions implements VisitorSessions {
  private readonly prefix: string;
  constructor(
    private readonly command: Command,
    namespace: string,
  ) {
    this.prefix = 'campus:{' + hash(namespace).toString('hex') + '}:';
  }
  private key(id: string) {
    return this.prefix + hash('lookup:' + id).toString('hex');
  }
  async create(session: Session) {
    const created = await this.command([
      'EVAL',
      createScript,
      2,
      this.key(session.id),
      this.prefix + 'active',
      seal(session.id, 'session', session),
      sessionLifetimeMs,
      Date.now(),
      sessionCapacity,
    ]);
    return created === 1;
  }
  async read(id: string) {
    const key = this.key(id);
    const result = await this.command(['MGET', key, key + ':evidence']);
    if (!Array.isArray(result)) throw new SessionStorageError();
    return unpack(id, result[0], result[1]);
  }
  async claim(id: string): Promise<SessionLease | undefined> {
    const key = this.key(id),
      lock = key + ':lease',
      owner = randomUUID();
    // Longer than the 90s comparison deadline. A terminated worker cannot overwrite a new owner.
    const result = await this.command([
      'EVAL',
      claimScript,
      3,
      key,
      lock,
      key + ':evidence',
      owner,
      120_000,
    ]);
    if (!Array.isArray(result)) throw new SessionStorageError();
    const record = unpack(id, result[0], result[2]);
    if (!record) return;
    if (result[1] !== 1) return { busy: true, record };
    return {
      busy: false,
      record,
      finish: async (updated) => {
        const evidence = updated?.evidence;
        const saved = await this.command([
          'EVAL',
          finishScript,
          4,
          key,
          lock,
          this.prefix + 'active',
          key + ':evidence',
          owner,
          updated ? seal(id, 'session', { ...updated.session, photoEvidence: null }) : '',
          sessionLifetimeMs,
          Date.now() + sessionLifetimeMs,
          evidence ? seal(id, 'evidence', evidence) : '',
          evidence ? Math.max(0, Date.parse(evidence.evidence.expiresAt) - Date.now()) : 0,
        ]);
        if (saved !== 1) throw new SessionStorageError();
      },
    };
  }
}

// One rolling budget per provider key, including retries and calls on different deployments.
const reserveScript = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 86400000)
local delay = 0
if redis.call('ZCOUNT', KEYS[1], '(' .. (now - 60000), '+inf') >= tonumber(ARGV[2]) then
  local first = redis.call('ZRANGEBYSCORE', KEYS[1], '(' .. (now - 60000), '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  delay = tonumber(first[2]) + 60000 - now
end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  delay = math.max(delay, tonumber(first[2]) + 86400000 - now)
end
if delay > 0 then return math.ceil(delay / 1000) end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], 86400000)
return 0`;
export function sharedAiBudget(command: Command, apiKey: string) {
  const key = 'campus:ai:' + hash(apiKey).toString('hex');
  return async (minute: number, day: number) => {
    let seconds: unknown;
    try {
      seconds = await command([
        'EVAL',
        reserveScript,
        1,
        key,
        Date.now(),
        minute,
        day,
        randomUUID(),
      ]);
    } catch {
      throw new ProviderError(
        'The AI request budget is temporarily unavailable.',
        503,
        'unavailable',
        true,
      );
    }
    if (typeof seconds !== 'number') throw new SessionStorageError();
    if (seconds > 0)
      throw new ProviderError(
        'AI request budget reached. Try again in ' + seconds + ' seconds.',
        429,
        'budget',
        true,
        seconds,
      );
  };
}
