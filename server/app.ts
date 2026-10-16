import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { coverage, root } from './data';
import { newSession } from './session';
import { ProviderError, type Provider } from './provider';
import type { Session } from '../src/types';
import { visualPlans } from './visual-data';
import { analyzeCampusPhoto } from './photo-localization';
import { readPhotoEvidence, PhotoEvidenceError, type PhotoEvidenceRecord } from './photo-evidence';
import { photoEvidenceRequestSchema, photoRequestSchema, releasePhotoBytes } from './photo-media';
import { directionCatalogue, resolveCampusDestination, routeCampus } from './directions';

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reset') }).strict(),
]);

export function createApp(options: {
  provider: Provider;
  liveAvailable: boolean;
  model: string;
  setupNotice?: string | null;
}) {
  const app = express();
  const sessions = new Map<string, Session>(),
    busy = new Set<string>();
  const photoEvidence = new Map<string, PhotoEvidenceRecord>();
  const requestCounts = new Map<string, { count: number; start: number }>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions)
      if (!busy.has(id) && now - session.lastTouched > 1800000) {
        sessions.delete(id);
        photoEvidence.delete(id);
      }
    for (const [id, record] of photoEvidence)
      if (!busy.has(id) && Date.parse(record.evidence.expiresAt) <= now) {
        photoEvidence.delete(id);
        const session = sessions.get(id);
        if (session?.photoEvidence?.id === record.evidence.id) session.photoEvidence = null;
      }
    for (const [ip, counter] of requestCounts)
      if (now - counter.start > 60000) requestCounts.delete(ip);
  }, 60000);
  cleanup.unref();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) {
      res.status(403).json({ error: 'Use the same origin as the application.' });
      return;
    }
    const ip = req.ip ?? 'local',
      now = Date.now();
    if (requestCounts.size > 1000)
      for (const [key, item] of requestCounts)
        if (now - item.start > 60000) requestCounts.delete(key);
    const rate = requestCounts.get(ip);
    if (!rate || now - rate.start > 60000) requestCounts.set(ip, { count: 1, start: now });
    else if (++rate.count > 180) {
      res.status(429).json({ error: 'Please pause briefly before trying again.' });
      return;
    }
    next();
  });
  app.use('/api/sessions/:id/photo', express.json({ limit: '4mb' }));
  app.use(express.json({ limit: '12kb' }));
  app.get('/api/bootstrap', (_req, res) =>
    res.json({
      coverage,
      liveAvailable: options.liveAvailable,
      model: options.model,
      setupNotice: options.liveAvailable ? null : (options.setupNotice ?? null),
      visualPlans,
      photoLocalizationAvailable: visualPlans.length > 0,
      directions: directionCatalogue,
    }),
  );
  app.post('/api/directions', (req, res) => {
    const parsed = z
      .object({ fromNodeId: z.string().min(1), destination: z.string().trim().min(1).max(120) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a destination.' });
      return;
    }
    try {
      const destination = resolveCampusDestination(parsed.data.destination);
      if (destination.kind === 'unmapped-room-label') {
        res.json({
          route: null,
          destination: destination.resolution,
          message: `Found this label on ${destination.resolution.building}, floor ${destination.resolution.floor}, but no outdoor route is mapped there.`,
        });
        return;
      }
      if (destination.kind === 'room-label' && destination.nodeId === parsed.data.fromNodeId) {
        res.json({
          route: null,
          destination: destination.resolution,
          message: `Found this label on ${destination.resolution.building}, floor ${destination.resolution.floor}. An indoor route to the room is not mapped.`,
        });
        return;
      }
      const route = routeCampus(parsed.data.fromNodeId, destination.nodeId);
      res.json({
        route,
        destination: destination.resolution,
        ...(destination.kind === 'room-label'
          ? {
              message: `Outdoor route to the ${destination.resolution.building} vicinity only. Indoor route to this room is not mapped.`,
            }
          : {}),
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Could not resolve this destination.',
      });
    }
  });
  app.post('/api/sessions', (req, res) => {
    if (
      !z
        .object({})
        .strict()
        .safeParse(req.body ?? {}).success
    ) {
      res.status(400).json({ error: 'Start a session without mode or location overrides.' });
      return;
    }
    for (const [id, session] of sessions)
      if (Date.now() - session.lastTouched > 1800000) sessions.delete(id);
    if (sessions.size >= 200) {
      res.status(503).json({ error: 'Session capacity reached. Try again later.' });
      return;
    }
    const session = newSession(options.liveAvailable);
    sessions.set(session.id, session);
    res.status(201).json(session);
  });
  app.get('/api/sessions/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session || Date.now() - session.lastTouched > 1800000) {
      sessions.delete(req.params.id);
      res.status(404).json({ error: 'Session expired. Reload to start a new private session.' });
      return;
    }
    res.json(session);
  });
  async function handlePhotoStage(
    req: express.Request<{ id: string }>,
    res: express.Response,
    stage: 'evidence' | 'location',
  ) {
    const session = sessions.get(req.params.id);
    if (!session || Date.now() - session.lastTouched > 1800000) {
      res.status(404).json({ error: 'Session expired. Reload to start again.' });
      return;
    }
    const parsed = (
      stage === 'evidence' ? photoEvidenceRequestSchema : photoRequestSchema
    ).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          stage === 'evidence'
            ? 'Choose a valid photo with its detail crops and explicitly agree to send it to Gemini.'
            : 'Read the photo labels first, then submit the same photo and detail crops with its evidence ID.',
      });
      return;
    }
    if (!options.liveAvailable) {
      res.status(503).json({
        error:
          options.setupNotice ??
          'Gemini is not configured. Add the server API key and free-tier confirmation, then restart.',
        providerError: { code: 'configuration', retryable: false },
        session,
      });
      return;
    }
    const input = parsed.data;
    const actionKey = `photo:${stage}:${input.requestId}`;
    if (session.appliedActions.includes(actionKey)) {
      res.json(session);
      return;
    }
    if (busy.has(session.id) || input.revision !== session.revision) {
      res.status(409).json({
        error: 'The session changed. Your view has been refreshed; try the photo again.',
        session,
      });
      return;
    }
    busy.add(session.id);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      if (stage === 'evidence') {
        const record = await readPhotoEvidence(session, input, options.provider, controller.signal);
        photoEvidence.set(session.id, record);
      } else if ('evidenceId' in input && typeof input.evidenceId === 'string') {
        await analyzeCampusPhoto(
          session,
          { ...input, evidenceId: input.evidenceId },
          options.provider,
          photoEvidence.get(session.id),
          controller.signal,
        );
        photoEvidence.delete(session.id);
      } else {
        throw new PhotoEvidenceError('Read this photo’s labels before comparing plans.');
      }
      session.appliedActions.push(actionKey);
      session.appliedActions = session.appliedActions.slice(-80);
      session.revision++;
      session.lastTouched = Date.now();
      if (!res.destroyed) res.json(session);
    } catch (error) {
      session.revision++;
      session.lastTouched = Date.now();
      if (!res.destroyed) {
        if (error instanceof ProviderError && error.retryAfterSeconds)
          res.set('Retry-After', String(error.retryAfterSeconds));
        res
          .status(
            error instanceof ProviderError || error instanceof PhotoEvidenceError
              ? error.httpStatus
              : 400,
          )
          .json({
            error: error instanceof Error ? error.message : 'The photo could not be compared.',
            ...(error instanceof ProviderError
              ? {
                  providerError: {
                    code: error.code,
                    retryable: error.retryable,
                    retryAfterSeconds: error.retryAfterSeconds,
                  },
                }
              : {}),
            session,
          });
      }
    } finally {
      // No media is copied into session state, disk, or logs; release request references.
      releasePhotoBytes(input);
      releasePhotoBytes(req.body);
      busy.delete(session.id);
    }
  }
  app.post('/api/sessions/:id/photo/evidence', (req, res) =>
    handlePhotoStage(req, res, 'evidence'),
  );
  app.post('/api/sessions/:id/photo', (req, res) => handlePhotoStage(req, res, 'location'));
  app.post('/api/sessions/:id/actions', async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session || Date.now() - session.lastTouched > 1800000) {
      sessions.delete(req.params.id);
      res.status(404).json({ error: 'Session expired. Reload to start again.' });
      return;
    }
    const envelope = z
      .object({
        requestId: z.string().uuid(),
        revision: z.number().int().min(0),
        action: actionSchema,
      })
      .strict()
      .safeParse(req.body);
    if (!envelope.success) {
      res.status(400).json({ error: 'Invalid action. Check the fields and try again.' });
      return;
    }
    const { requestId, revision, action } = envelope.data;
    if (session.appliedActions.includes(requestId)) {
      res.json(session);
      return;
    }
    if (busy.has(session.id) || revision !== session.revision) {
      res.status(409).json({
        error: 'The session changed. Your view has been refreshed; try the action again.',
        session,
      });
      return;
    }
    busy.add(session.id);
    try {
      if (action.type === 'reset') {
        photoEvidence.delete(session.id);
        Object.assign(session, newSession(options.liveAvailable), {
          id: session.id,
          revision: session.revision,
          appliedActions: session.appliedActions,
        });
      }
      session.appliedActions.push(requestId);
      session.appliedActions = session.appliedActions.slice(-80);
      session.revision++;
      session.lastTouched = Date.now();
      res.json(session);
    } catch (error) {
      session.revision++;
      session.lastTouched = Date.now();
      if (error instanceof ProviderError && error.retryAfterSeconds) {
        res.set('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(error instanceof ProviderError ? error.httpStatus : 400).json({
        error: error instanceof Error ? error.message : 'Action could not be completed.',
        ...(error instanceof ProviderError
          ? {
              providerError: {
                code: error.code,
                retryable: error.retryable,
                retryAfterSeconds: error.retryAfterSeconds,
              },
            }
          : {}),
        session,
      });
    } finally {
      busy.delete(session.id);
    }
  });
  // Uploaded photos are transient request bodies. Only public source-derived assets are served.
  app.use(
    '/data/campus/visual',
    express.static(`${root}/data/campus/visual`, {
      dotfiles: 'deny',
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
    }),
  );
  app.use(
    '/data/campus/raw',
    express.static(`${root}/data/campus/raw`, {
      dotfiles: 'deny',
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
    }),
  );
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, mode: 'local-prototype', requestId: randomUUID() }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const tooLarge = (error as { type?: string })?.type === 'entity.too.large';
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? 'The image request is too large. Choose a smaller photo.'
          : error instanceof SyntaxError
            ? 'Invalid request JSON.'
            : 'Request rejected. Check its size and format.',
      });
    },
  );
  return app;
}
