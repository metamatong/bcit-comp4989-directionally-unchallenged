import express from 'express';
import { randomUUID } from 'node:crypto';
import { root } from './data';
import type { Provider } from './provider';
import { visualPlans } from './visual-data';
import { floorGraphs, pilotDestinations } from './floor-graph';
import { locationCatalogue } from './geolocation';
import { isPilotBuilding, isPilotPlan } from './pilot-scope';
import type { LocationCatalogue } from '../src/location/types';
import { protectTopologyFiles } from './topology-api';
import { TopologyStore } from './topology';
import {
  MemoryVisitorSessions,
  SessionStorageError,
  type VisitorSessions,
} from './visitor-sessions';
import { visitorRouter } from './visitor-api';
import { checkPublishedRoute } from './routing-readiness';
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
  const visitorPlans = visualPlans.filter(isPilotPlan);
  const visitorCoverage = {
    floorPlans: visitorPlans.length,
    buildings: [...new Set(visitorPlans.map((plan) => plan.building))],
    extractedLabelCandidates: visitorPlans.reduce((sum, plan) => sum + plan.labelCount, 0),
  };
  let locationData: LocationCatalogue | undefined;
  let locationNotice: string | undefined;
  try {
    const catalogue = locationCatalogue();
    locationData = {
      ...catalogue,
      buildings: catalogue.buildings.filter((building) => isPilotBuilding(building.building)),
      floors: catalogue.floors.filter((floor) => {
        const plan = visualPlans.find((item) => item.id === floor.planId);
        return !!plan && isPilotPlan(plan);
      }),
    };
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
  app.get('/api/bootstrap', (_req, res) =>
    res.json({
      coverage: visitorCoverage,
      liveAvailable: options.liveAvailable,
      model: options.model,
      provider: options.provider.name ?? 'gemini',
      setupNotice: options.liveAvailable ? null : (options.setupNotice ?? null),
      visualPlans: visitorPlans,
      destinations: pilotDestinations(),
      locationCatalogue: locationData,
      locationNotice,
      photoLocalizationAvailable: visitorPlans.length > 0,
    }),
  );
  // Public corridor/lobby walking cells for client-side map-matching; kept distinct from GIS alignments.
  app.get('/api/plans/:planId/walking-surface', (req, res) => {
    const plan = visitorPlans.find((item) => item.id === req.params.planId);
    const floor = plan ? floorGraphs().byId.get(plan.id) : undefined;
    if (!plan || !floor || floor.plan.sourceSha256 !== plan.sourceSha256) {
      res.status(404).json({ error: 'Floor walking surface is unavailable for this plan.' });
      return;
    }
    res.json({
      planId: floor.plan.id,
      sourceSha256: floor.plan.sourceSha256,
      graphVersion: floor.version,
      step: floor.step,
      runs: floor.runs,
    });
  });
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
  let hostedRouteCheck: ReturnType<typeof checkPublishedRoute> | undefined;
  app.get('/api/health', async (req, res) => {
    const health = {
      mode: options.hosted ? 'hosted-prototype' : 'local-prototype',
      requestId: randomUUID(),
    };
    if (req.query.check !== 'routing') {
      res.json({ ...health, ok: true });
      return;
    }
    try {
      // The packaged topology is immutable for the lifetime of a hosted worker.
      const routing = options.hosted
        ? await (hostedRouteCheck ??= checkPublishedRoute(topologyStore))
        : await checkPublishedRoute(topologyStore);
      res.json({ ...health, ok: true, routing });
    } catch {
      res
        .status(503)
        .json({ ...health, ok: false, error: 'Published reference route unavailable.' });
    }
  });
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
