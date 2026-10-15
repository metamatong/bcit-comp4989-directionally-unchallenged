import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { catalogue, coverage, root } from './data';
import { newSession } from './session';
import { searchCampus } from './retrieval';
import { ProviderError, type Provider } from './provider';
import type { Session } from '../src/types';
import { visualPlans } from './visual-data';
import { analyzeCampusPhoto, confirmCampusRegion, photoRequestSchema } from './photo-localization';

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm-campus-region'), candidateId: z.string().uuid() }).strict(),
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
  const requestCounts = new Map<string, { count: number; start: number }>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions)
      if (!busy.has(id) && now - session.lastTouched > 1800000) sessions.delete(id);
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
      catalogue: catalogue.map(({ text: _text, ...record }) => record),
      coverage,
      liveAvailable: options.liveAvailable,
      model: options.model,
      setupNotice: options.liveAvailable ? null : (options.setupNotice ?? null),
      visualPlans,
      photoLocalizationAvailable: visualPlans.length > 0,
    }),
  );
  app.get('/api/search', (req, res) =>
    res.json(searchCampus(String(req.query.q ?? '').slice(0, 100))),
  );
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
  app.post('/api/sessions/:id/photo', async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session || Date.now() - session.lastTouched > 1800000) {
      res.status(404).json({ error: 'Session expired. Reload to start again.' });
      return;
    }
    const parsed = photoRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Choose a valid photo and explicitly agree to send it to Gemini.' });
      return;
    }
    if (!options.liveAvailable) {
      res.status(503).json({
        error:
          options.setupNotice ??
          'Gemini is not configured. Add the server API key and free-tier confirmation, then restart. The official plan library remains available.',
        providerError: { code: 'configuration', retryable: false },
        session,
      });
      return;
    }
    const input = parsed.data;
    if (session.appliedActions.includes(input.requestId)) {
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
      await analyzeCampusPhoto(session, input, options.provider, controller.signal);
      session.appliedActions.push(input.requestId);
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
        res.status(error instanceof ProviderError ? error.httpStatus : 400).json({
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
      input.image.data = '';
      if (req.body?.image) req.body.image.data = '';
      busy.delete(session.id);
    }
  });
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
      if (action.type === 'confirm-campus-region') {
        confirmCampusRegion(session, action.candidateId);
      } else if (action.type === 'reset') {
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
