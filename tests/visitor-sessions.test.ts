/** Storage and lease regressions for visitor sessions on separate HTTP workers. */
import { expect, it, vi } from 'vitest';
import { newSession } from '../server/session';
import { MemoryVisitorSessions, SessionStorageError } from '../server/visitor-sessions';
import { RedisVisitorSessions, sharedAiBudget } from '../server/redis-visitor-sessions';
import { PHOTO_EVIDENCE_TTL_MS } from '../server/photo-evidence';

it('makes only committed revisions visible and releases unsuccessful local operations', async () => {
  const store = new MemoryVisitorSessions(),
    session = newSession();
  await store.create(session);
  const claim = await store.claim(session.id);
  if (!claim || claim.busy) throw new Error('Expected a session lease.');
  claim.record.session.revision++;
  expect((await store.claim(session.id))?.busy).toBe(true);
  expect((await store.read(session.id))?.session.revision).toBe(0);
  await claim.finish();
  const retry = await store.claim(session.id);
  if (!retry || retry.busy) throw new Error('Expected the lease to have been released.');
  retry.record.session.revision++;
  await retry.finish(retry.record);
  expect((await store.read(session.id))?.session.revision).toBe(1);
});

it('restores encrypted record and evidence on a second worker, with independent expiry', async () => {
  const send = vi.fn<(args: (string | number)[]) => Promise<unknown>>();
  const first = new RedisVisitorSessions(send, 'deployment'),
    second = new RedisVisitorSessions(send, 'deployment');
  const session = newSession();
  send.mockResolvedValueOnce(1);
  expect(await first.create(session)).toBe(true);
  const initial = send.mock.calls[0][0][5];
  send.mockResolvedValueOnce([initial, 1, '']);
  const lease = await first.claim(session.id);
  if (!lease || lease.busy) throw new Error('Expected a lease.');
  lease.record.session.revision++;
  const evidence = {
    id: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    labels: [],
    observations: ['An observable corridor'],
    readAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PHOTO_EVIDENCE_TTL_MS).toISOString(),
    usedFallbackModel: false,
  };
  lease.record.evidence = {
    sessionId: session.id,
    fingerprint: 'bound-to-image-and-crops',
    evidence,
  };
  lease.record.session.photoEvidence = evidence;
  send.mockResolvedValueOnce(1);
  await lease.finish(lease.record);
  const write = send.mock.calls[2][0];
  expect(JSON.stringify(write)).not.toContain(session.id);
  expect(JSON.stringify(write)).not.toContain('observable corridor');
  expect(JSON.stringify(write)).not.toContain('bound-to-image-and-crops');
  expect(Number(write.at(-1))).toBeGreaterThan(0);
  expect(Number(write.at(-1))).toBeLessThanOrEqual(PHOTO_EVIDENCE_TTL_MS);
  send.mockResolvedValueOnce([write[8], write[11]]);
  expect(await second.read(session.id)).toEqual(lease.record);
  send.mockResolvedValueOnce([write[8], null]);
  expect((await second.read(session.id))?.session.photoEvidence).toBeNull();
  send.mockResolvedValueOnce([write[8], write[11]]);
  await expect(second.read(newSession().id)).rejects.toBeInstanceOf(SessionStorageError);
});

it('enforces shared Gemini budgets before a provider call', async () => {
  const command = vi
    .fn()
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(9)
    .mockRejectedValueOnce(new Error('offline'));
  const reserve = sharedAiBudget(command, 'private-test-key');
  await reserve(6, 60);
  await expect(reserve(6, 60)).rejects.toMatchObject({
    httpStatus: 429,
    code: 'budget',
    retryAfterSeconds: 9,
  });
  await expect(reserve(6, 60)).rejects.toMatchObject({ httpStatus: 503 });
  expect(JSON.stringify(command.mock.calls)).not.toContain('private-test-key');
});
