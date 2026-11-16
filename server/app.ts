import express from 'express';
import { randomUUID } from 'node:crypto';
import { coverage, root } from './data';
import type { Provider } from './provider';
import { visualPlans } from './visual-data';
import { locationCatalogue } from './geolocation';
import type { LocationCatalogue } from '../src/location/types';
import { createTopologyRouter, protectTopologyFiles, requireLocalTopology } from './topology-api';
import { TopologyStore } from './topology';
import {
  MemoryVisitorSessions,
  SessionStorageError,
  type VisitorSessions,
} from './visitor-sessions';
import { visitorRouter } from './visitor-api';
export { actionSchema } from './visitor-api';

export function createApp(options: {
  provider: Provider;
  liveAvailable: boolean;
  model: string;
  setupNotice?: string | null;
  topologyStore?: TopologyStore;
  sessions?: VisitorSessions;
  hosted?: boolean;
}) {
  const app = express();
  let locationData: LocationCatalogue | undefined;
  let locationNotice: string | undefined;
  try {
    locationData = locationCatalogue();
  } catch {
    locationNotice =
      'Device-location source validation failed. Photo analysis remains available. Restore the location source data and restart the server.';
  }
  const topologyStore = options.topologyStore ?? new TopologyStore();
  const requestCounts = new Map<string, { count: number; start: number }>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, counter] of requestCounts)
      if (now - counter.start > 60000) requestCounts.delete(ip);
  }, 60000);
  cleanup.unref();
  app.disable('x-powered-by');
  app.use(protectTopologyFiles);
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
  if (options.hosted) {
    app.use(['/api/internal/topology', '/internal/topology'], (_req, res) => {
      res
        .status(403)
        .json({ error: 'The topology editor is available only on the local workstation.' });
    });
  } else {
    app.use('/api/internal/topology', createTopologyRouter(topologyStore));
    app.use('/internal/topology', requireLocalTopology);
  }
  app.get('/api/bootstrap', (_req, res) =>
    res.json({
      coverage,
      liveAvailable: options.liveAvailable,
      model: options.model,
      setupNotice: options.liveAvailable ? null : (options.setupNotice ?? null),
      visualPlans,
      locationCatalogue: locationData,
      locationNotice,
      photoLocalizationAvailable: visualPlans.length > 0,
    }),
  );
  app.use(
    '/api/sessions',
    visitorRouter(options, options.sessions ?? new MemoryVisitorSessions(), topologyStore),
  );
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
    res.json({
      ok: true,
      mode: options.hosted ? 'hosted-prototype' : 'local-prototype',
      requestId: randomUUID(),
    }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof SessionStorageError) {
        res.status(503).json({ error: error.message });
        return;
      }
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
