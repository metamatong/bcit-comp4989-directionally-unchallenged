/** Resolve the two ends of a visitor journey, then route over currently approved passages. */
import { z } from 'zod';
import type { CampusLocationCandidate, VisualPlan } from '../src/types';
import { planLabel, type TopologyNode, type TopologyEdge } from '../src/topology';
import type {
  NavigationChoice,
  NavigationResult,
  MapStop,
  PlaceChoice,
  StartingPoints,
  WalkingStep,
} from '../src/wayfinding';
import { canonicalBuilding, isPilotPlan, labelKey } from './pilot-evidence';
import { reviewedNetwork } from './pilot-network';
import { lookupPilotLabels } from './spatial-retrieval';
import { computeTopologyRoute } from './routing';
import { TopologyError, TopologyStore, topologyEligibility } from './topology';
import { visitorPassages } from './visitor-paths';

export const startingPointsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    candidateId: z.string().uuid(),
  })
  .strict();
export const navigationSchema = startingPointsSchema
  .extend({
    destination: z.string().trim().min(1).max(150),
    originId: z.string().uuid().optional(),
    destinationId: z.string().min(1).max(180).optional(),
    networkRevision: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((r) => !(r.originId || r.destinationId) || r.networkRevision !== undefined);

function stop(node: TopologyNode): MapStop {
  return {
    id: node.id,
    planId: node.planId,
    label: node.label.replace(/ 후보$/, ''),
    point: node.point,
  };
}

function destinationText(value: string) {
  // Strip only complete request wrappers. Retain all digits and letters of the identifier.
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^(?:take me to|directions to|navigate to|go to)\s+/i, '')
    .replace(
      /(?:호(?:실)?)?(?:으?로\s*(?:가고\s*싶(?:어|어요)|가\s*주세요|안내해\s*줘))\s*[.!?]?$/u,
      '',
    )
    .replace(/(\d[A-Za-z]?)호(?:실)?$/u, '$1')
    .replace(/^((?:(?:NE|NW|SE|SW)\d+[\s-]+)?)room\s+/i, '$1')
    .trim();
}

type Destination = { place: PlaceChoice; nodes: TopologyNode[] };
function resolveDestination(
  text: string,
  nodes: TopologyNode[],
  doors: Map<string, string>,
): Destination[] {
  const cleaned = labelKey(destinationText(text));
  if (!cleaned) return [];
  const scoped = /^(?:((?:NE|NW|SE|SW)\d+)[\s-]+)?(?:(?:floor\s+(\d+)\s+|(\d+)층\s*))?(.+)$/i.exec(
    cleaned,
  )!;
  const building = scoped[1] && canonicalBuilding(scoped[1]),
    floor = scoped[2] || scoped[3];
  if (scoped[1] && !building) return [];
  const token = scoped[4].replace(/^room\s+/i, '');
  if (!token.trim()) return [];
  const scopedNodes = nodes.filter(
    (n) =>
      (!building || n.planId.startsWith(building + '-')) &&
      (!floor || n.planId.split('-')[1] === 'F' + floor),
  );
  const kind = new Map<string, TopologyNode['kind']>([
    ['ELEVATOR', 'elevator-stop'],
    ['LIFT', 'elevator-stop'],
    ['엘리베이터', 'elevator-stop'],
    ['STAIRS', 'stair-landing'],
    ['계단', 'stair-landing'],
    ['EXTERIOR DOOR', 'outdoor-access'],
    ['외부 출입문', 'outdoor-access'],
  ]).get(labelKey(token));
  if (kind)
    return scopedNodes.filter((n) => n.kind === kind).map((n) => ({ place: stop(n), nodes: [n] }));
  const query = lookupPilotLabels({
    purpose: 'destination',
    labels: [token],
    ...(building ? { building } : {}),
    ...(floor ? { floor } : {}),
  }).results[0];
  if (query.unsupportedScope) return [];
  const published = new Map(reviewedNetwork().nodes.map((n) => [n.id, n]));
  // Look up live-approved aliases too. A nearby room number on a landing is never a room-door alias.
  const named = scopedNodes.filter((node) => {
    const record = published.get(node.id);
    const aliases =
      record?.reviewContentHash === node.review?.contentHash ? (record?.aliases ?? []) : [];
    const stair = node.kind === 'stair-landing' && /^([A-Z]?\d+[A-Z]?) · /.exec(node.label)?.[1];
    return [node.label, ...aliases, ...(stair ? [stair] : [])].some(
      (alias) => labelKey(alias) === query.identifier,
    );
  });
  const choices: Destination[] = [];
  for (const match of query.matches) {
    const checkpoints = named.filter((n) => n.planId === match.planId);
    const roomDoors = new Set(match.doorHypotheses.map((d) => doors.get(d.id)).filter(Boolean));
    const approaches = nodes.filter((n) => roomDoors.has(n.id));
    // Several occurrences of the same printed label on one page are distinct.
    // A door-to-room binding identifies an occurrence only when that room label is unique there.
    for (const occurrence of match.occurrences) {
      const bound =
        match.occurrences.length === 1 ? [...new Set([...approaches, ...checkpoints])] : [];
      choices.push({
        place: {
          id: occurrence.occurrenceId,
          planId: match.planId,
          label: occurrence.label,
          bounds: occurrence.bounds,
        },
        nodes: bound,
      });
    }
    if (match.occurrences.length === 1) {
      for (const n of checkpoints) named.splice(named.indexOf(n), 1);
    }
  }
  for (const node of named) choices.push({ place: stop(node), nodes: [node] });
  return choices;
}

function stepText(kind: TopologyEdge['kind'], to: MapStop, plans: VisualPlan[]) {
  const target = planLabel(plans.find((p) => p.id === to.planId)!);
  switch (kind) {
    case 'stairs':
      return `Take the stairs to ${target}.`;
    case 'elevator':
      return `Take the elevator to ${target}.`;
    case 'building-link':
      return `Use the connecting passage to ${target}.`;
    case 'outdoor':
      return `Go outside and enter through the marked door on ${target}. The outdoor walking line has not been mapped.`;
    case 'corridor':
      return `Follow the marked corridor to ${to.label}.`;
  }
}

/** Omit a doubled-back segment only when both approved traces traverse the exact same vertices. */
function removeBacktracking(steps: WalkingStep[]) {
  const result: WalkingStep[] = [];
  for (const step of steps) {
    const prior = result.at(-1);
    if (prior?.kind === 'corridor' && step.kind === 'corridor' && prior.to.id === step.from.id) {
      let shared = 0;
      while (shared < Math.min(prior.path.length, step.path.length)) {
        const a = prior.path[prior.path.length - 1 - shared],
          b = step.path[shared];
        if (a.x !== b.x || a.y !== b.y) break;
        shared++;
      }
      if (shared >= 2) {
        result[result.length - 1] = {
          ...prior,
          to: step.to,
          path: [
            ...prior.path.slice(0, prior.path.length - shared + 1),
            ...step.path.slice(shared),
          ],
          instruction: `Follow the marked corridor from ${prior.from.label} to ${step.to.label}.`,
        };
        continue;
      }
    }
    result.push(step);
  }
  return result;
}

function readVisitorMap(
  candidate: CampusLocationCandidate,
  store: TopologyStore,
  expectedRevision?: number,
) {
  const plans = store.plans.filter(isPilotPlan);
  if (!plans.some((p) => p.id === candidate.planId))
    throw new TopologyError('Confirm a current photo region in SE12, SW03 or SW01 first.', 409);
  const doc = store.read();
  if (expectedRevision !== undefined && expectedRevision !== doc.revision)
    throw new TopologyError(
      'The walking map changed. Check the starting point and destination again.',
      409,
    );
  const eligible = topologyEligibility(doc, plans);
  const network = visitorPassages(doc, eligible, store.candidates, plans);
  const approved = new Set(eligible.nodeIds);
  const nodes = doc.nodes.filter((n) => approved.has(n.id));
  const vicinity = candidate.doorwayVicinity;
  const activeDoor = vicinity ? network.doors.get(vicinity.doorId) : undefined;
  const origins = nodes
    .filter((n) => {
      if (n.planId !== candidate.planId) return false;
      if (vicinity)
        return (
          n.id === activeDoor &&
          n.sourceSha256 === vicinity.sourceSha256 &&
          n.point.x === vicinity.point.x &&
          n.point.y === vicinity.point.y
        );
      const bounds = candidate.bounds;
      return (
        !!bounds &&
        n.point.x >= bounds[0] &&
        n.point.x <= bounds[2] &&
        n.point.y >= bounds[1] &&
        n.point.y <= bounds[3]
      );
    })
    .map(stop);
  return { plans, doc, network, nodes, origins };
}

/** Only selectable points are exposed before the visitor confirms their starting location. */
export function startingPoints(
  candidate: CampusLocationCandidate,
  store: TopologyStore,
): StartingPoints {
  const { doc, origins } = readVisitorMap(candidate, store);
  return { networkRevision: doc.revision, origins };
}

export function planVisitorJourney(
  candidate: CampusLocationCandidate,
  request: NavigationChoice,
  store: TopologyStore,
): NavigationResult {
  if (candidate.id !== request.candidateId)
    throw new TopologyError('Confirm the current photo region before requesting directions.', 409);
  const { plans, doc, network, nodes, origins } = readVisitorMap(
    candidate,
    store,
    request.networkRevision,
  );
  const vicinity = candidate.doorwayVicinity;
  const choices = resolveDestination(request.destination, nodes, network.doors);
  const context = {
    networkRevision: doc.revision,
    origins,
    destinations: choices.map((c) => c.place),
  };
  if (!choices.length)
    return {
      ...context,
      status: 'unknown-destination',
      message:
        'This destination has no exact label on the pilot plans. Check the building and complete room or stair identifier.',
    };
  const choice = request.destinationId
    ? choices.find((c) => c.place.id === request.destinationId)
    : choices.length === 1
      ? choices[0]
      : undefined;
  if (!choice)
    return {
      ...context,
      status: 'choose-destination',
      message:
        'This label identifies more than one place. Choose the one you mean on its floor plan.',
    };
  if (!choice.nodes.length && !origins.length)
    return {
      ...context,
      status: 'unmapped-origin-and-destination',
      message:
        'The destination label is marked. The confirmed photo region has no reviewed starting point, and this destination still needs a reviewed walking connection.',
    };
  if (!choice.nodes.length)
    return {
      ...context,
      status: 'unmapped-destination',
      message:
        'The label is marked on the floor plan. A walking connection to this destination still needs review.',
    };
  if (!origins.length)
    return {
      ...context,
      status: 'unmapped-origin',
      message: vicinity
        ? `The corridor outside room ${vicinity.room} is identified. Its connection to the walking network still needs review.`
        : 'There is no reviewed starting point inside your confirmed region. Try a photo at a marked doorway, stair landing or elevator.',
    };
  const origin = origins.find((n) => n.id === request.originId);
  if (!origin)
    return {
      ...context,
      status: 'choose-origin',
      message: 'Which marked point are you standing at? Check it against your surroundings.',
    };
  const routes = choice.nodes
    .map((n) =>
      computeTopologyRoute(
        doc,
        {
          revision: doc.revision,
          fromNodeId: origin.id,
          toNodeId: n.id,
          mode: 'fewest-connections',
        },
        plans,
        network.allowed,
      ),
    )
    .filter((r) => r.outcome === 'route')
    .sort((a, b) => a.edgeIds.length - b.edgeIds.length);
  const route = routes[0];
  if (!route)
    return {
      ...context,
      status: 'no-route',
      message:
        'The marked places are known, but a continuous reviewed walking route between them is missing.',
    };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = new Map(doc.edges.map((e) => [e.id, e]));
  const steps: WalkingStep[] = route.edgeIds.map((id, index) => {
    const edge = edges.get(id)!,
      from = stop(byId.get(route.nodeIds[index])!),
      to = stop(byId.get(route.nodeIds[index + 1])!);
    const trace = network.traces.get(id);
    return {
      kind: edge.kind,
      from,
      to,
      instruction: trace?.instruction ?? stepText(edge.kind, to, plans),
      path: trace ? (trace.fromId === from.id ? trace.path : [...trace.path].reverse()) : [],
    };
  });
  return {
    ...context,
    status: 'route',
    origin,
    destination: stop(byId.get(route.nodeIds.at(-1)!)!),
    steps: removeBacktracking(steps),
  };
}
