/** Five reproducible, unfiltered visitor API journeys using post-extraction sign readings. */
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import { createApp } from '../server/app';
import {
  floorGraphs,
  sourceBuilding,
  visitorExclusion,
  type FloorPlace,
} from '../server/floor-graph';
import { newSession } from '../server/session';
import { MemoryVisitorSessions } from '../server/visitor-sessions';
import type { PhotoEvidence, Session } from '../src/types';
import type { NavigationResult, StartingPoints } from '../src/wayfinding';

const { values, positionals } = parseArgs({
  options: { building: { type: 'string' }, network: { type: 'boolean' } },
  allowPositionals: true,
});
if (positionals.length > 1) throw Error('Supply at most one random seed.');
const building = values.building && sourceBuilding(values.building);
if (values.building && !building) throw Error('Select a supplied Burnaby building.');
if (building && values.network)
  throw Error('Choose the three-building network or a single building.');
const seed = positionals[0] ?? randomBytes(4).toString('hex');
if (!/^[0-9a-f]{8}$/i.test(seed)) throw Error('Supply an eight-digit hexadecimal random seed.');
let state = parseInt(seed, 16);
function draw(limit: number) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return Math.floor((state / 2 ** 32) * limit);
}
const places = floorGraphs()
  .ordered.filter((f) =>
    values.network
      ? ['SW1', 'SW3', 'SE12'].includes(f.plan.building)
      : !building || f.plan.building === building,
  )
  .flatMap((f) => f.places)
  .filter((p) => !values.network || !visitorExclusion(p));
if (places.length < 10) throw Error('Ten distinct source occurrences are needed for five pairs.');
for (let i = 0; i < 10; i++) {
  const j = i + draw(places.length - i);
  [places[i], places[j]] = [places[j], places[i]];
}
const sessions = new MemoryVisitorSessions();
const app = createApp({
  sessions,
  liveAvailable: false,
  model: 'local route sample',
  provider: {
    calls: 0,
    async generate() {
      throw Error('The post-extraction route check attempted to call a provider.');
    },
  },
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/sessions/';
async function post<T>(path: string, body: unknown): Promise<T> {
  const reply = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!reply.ok) throw Error('Visitor API ' + reply.status + ' ' + (await reply.text()));
  return reply.json() as Promise<T>;
}
async function check(origin: FloorPlace, goal: FloorPlace) {
  const floor = floorGraphs().byId.get(origin.planId)!.plan,
    dest = floorGraphs().byId.get(goal.planId)!.plan;
  const session = newSession(false);
  const now = new Date();
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels: [
      { text: origin.label, kind: 'room', placement: 'door', clarity: 'clear', viewId: 'full' },
      {
        text: floor.building,
        kind: 'building',
        placement: 'other',
        clarity: 'clear',
        viewId: 'full',
      },
      { text: floor.floor, kind: 'floor', placement: 'other', clarity: 'clear', viewId: 'full' },
    ],
    observations: ['Sampled exact sign, building and floor from the source record.'],
    readAt: now.toISOString(),
    expiresAt: new Date(+now + 300000).toISOString(),
    usedFallbackModel: false,
  };
  session.photoEvidence = evidence;
  if (!(await sessions.create(session))) throw Error('Could not seed local session.');
  const lease = await sessions.claim(session.id);
  if (!lease || lease.busy) throw Error('Could not bind local evidence.');
  lease.record.evidence = { sessionId: session.id, fingerprint: 'sample-without-media', evidence };
  await lease.finish(lease.record);
  const endpoint = (suffix: string) => session.id + '/' + suffix;
  let located = await post<Session>(endpoint('photo/location'), {
    requestId: randomUUID(),
    revision: session.revision,
    evidenceId: evidence.id,
  });
  const candidate = located.campusAnalysis?.candidates.find((c) => c.sourcePlaceId === origin.id);
  const pair = {
    from: floor.building + ' F' + floor.floor + ' ' + origin.label,
    to: dest.building + ' F' + dest.floor + ' ' + goal.label,
  };
  if (!candidate) return { ...pair, status: 'unresolved-photo-label', origins: 0 };
  if (located.campusLocation?.id !== candidate.id) {
    located = await post<Session>(endpoint('actions'), {
      requestId: randomUUID(),
      revision: located.revision,
      action: { type: 'confirm-campus-region', candidateId: candidate.id },
    });
  }
  const request = { revision: located.revision, candidateId: candidate.id };
  const starts = await post<StartingPoints>(endpoint('navigation/origins'), request);
  // When the sign has multiple doors, select one as a visitor would before the single route search.
  const door = starts.origins.length ? starts.origins[draw(starts.origins.length)] : undefined;
  const result = await post<NavigationResult>(endpoint('navigation'), {
    ...request,
    originId: door?.id,
    destinationId: goal.id,
    networkRevision: starts.networkRevision,
    destination: dest.building + ' Floor ' + dest.floor + ' ' + goal.label,
  });
  if (
    result.status === 'route' &&
    (result.origin.id !== door?.id || result.destination.planId !== goal.planId)
  )
    throw Error('The returned path does not join the selected source places.');
  return {
    ...pair,
    status: result.status,
    origins: starts.origins.length,
    ...(result.status === 'route'
      ? { floors: [...new Set([result.origin.planId, ...result.steps.map((s) => s.to.planId)])] }
      : {
          reason: result.message,
          ...(result.mappedPortion
            ? {
                firstMappedStop: result.mappedPortion.origin.label,
                lastMappedStop: result.mappedPortion.destination.label,
              }
            : {}),
        }),
  };
}
try {
  console.log(
    JSON.stringify({
      seed,
      ...(building ? { building } : {}),
      ...(values.network ? { buildings: ['SE12', 'SW03', 'SW01'] } : {}),
      population: places.length,
      selection:
        'First five origins and next five destinations drawn without replacement before routing.',
    }),
  );
  for (let i = 0; i < 5; i++) console.log(JSON.stringify(await check(places[i], places[i + 5])));
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
