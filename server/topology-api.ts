import { Router, type RequestHandler } from 'express';
import { topologyRouteRequestSchema } from '../src/topology';
import { computeTopologyRoute } from './routing';
import { TopologyError, TopologyStore } from './topology';

/** Local workstation tool; forwarded headers never grant access. Also rejects DNS rebinding. */
export function isLocalTopologyRequest(address: string | undefined, host: string | undefined) {
  if (!address || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || !host)
    return false;
  try {
    const url = new URL(`http://${host}`);
    return (
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === '/'
    );
  } catch {
    return false;
  }
}
export const requireLocalTopology: RequestHandler = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!isLocalTopologyRequest(req.socket.remoteAddress, req.get('host'))) {
    res.status(403).json({
      error:
        'The topology editor is available only on this computer through localhost or 127.0.0.1.',
    });
    return;
  }
  if (req.get('sec-fetch-site') === 'cross-site') {
    res.status(403).json({ error: 'Open the editor directly from the local application.' });
    return;
  }
  next();
};
/** Vite serves workspace files in development; annotations must only leave through the guarded API. */
export const protectTopologyFiles: RequestHandler = (req, res, next) => {
  let segments: string[];
  try {
    segments = decodeURIComponent(req.path).split('/');
  } catch {
    res.status(400).json({ error: 'Invalid request path.' });
    return;
  }
  if (
    segments.some((segment) =>
      ['topology.json', 'connection-candidates.json'].some(
        (name) => segment === name || segment.startsWith(`${name}.`),
      ),
    )
  ) {
    res.status(404).json({ error: 'Topology storage is not a public asset.' });
    return;
  }
  next();
};
export function createTopologyRouter(store = new TopologyStore()) {
  const router = Router();
  router.use(requireLocalTopology);
  router.get('/', (_req, res) => {
    res.json(store.snapshot());
  });
  router.post('/edits', (req, res) => {
    res.json(store.mutate(req.body));
  });
  router.post('/route', (req, res) => {
    const parsed = topologyRouteRequestSchema.safeParse(req.body);
    if (!parsed.success)
      throw new TopologyError(
        'Choose saved endpoints, a graph revision, and a supported route objective.',
      );
    res.json(computeTopologyRoute(store.read(), parsed.data, store.plans));
  });
  router.use(
    (
      error: unknown,
      _req: Parameters<RequestHandler>[0],
      res: Parameters<RequestHandler>[1],
      _next: Parameters<RequestHandler>[2],
    ) => {
      res.status(error instanceof TopologyError ? error.httpStatus : 500).json({
        error:
          error instanceof TopologyError
            ? error.message
            : 'The topology operation failed. Reload before retrying.',
      });
    },
  );
  return router;
}
