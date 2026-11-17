/** Resolve visitor endpoints and generate floor-plan routes with mapped building-link constraints. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CampusLocationCandidate, VisualPlan } from '../src/types';
import { buildingLabel, planLabel, type TopologyNode, type TopologyEdge } from '../src/topology';
import type {
  NavigationChoice,
  NavigationResult,
  MapStop,
  PagePoint,
  PlaceChoice,
  StartingPoints,
  WalkingStep,
} from '../src/wayfinding';
import {
  canonicalBuilding,
  isPilotPlan,
  labelKey,
  looksLikeIdentifier,
  pilotEvidence,
} from './pilot-evidence';
import { reviewedNetwork } from './pilot-network';
import { lookupPilotLabels } from './spatial-retrieval';
import { computeTopologyRoute } from './routing';
import { TopologyError, TopologyStore, topologyEligibility } from './topology';
import { visitorPassages } from './visitor-paths';
import { planImagePart } from './visual-data';
import type { Provider } from './provider';

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
    label: node.label,
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
      /\b(NE|NW|SE|SW)\s*O(\d+)\b/i,
      (_match, area: string, digits: string) => `${area}0${digits}`,
    )
    .replace(/\b(NE|NW|SE|SW)\s*[- ]?\s*(\d+)\b/i, '$1$2')
    .replace(/^((?:(?:NE|NW|SE|SW)\d+[\s-]+)?)room\s+/i, '$1')
    .trim();
}

type Destination = { place: PlaceChoice; nodes: TopologyNode[]; typoCorrection?: string };
type PublishedCheckpoint = { reviewContentHash: string; aliases: string[] };

function oneCharacterTypo(value: string, candidate: string) {
  if (value.length < 4 || value.length !== candidate.length) return false;
  let differences = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== candidate[index] && ++differences > 1) return false;
  }
  return differences === 1;
}

function resolveDestination(
  text: string,
  nodes: TopologyNode[],
  doors: Map<string, string>,
  published: Map<string, PublishedCheckpoint>,
): Destination[] {
  const cleaned = labelKey(destinationText(text));
  if (!cleaned) return [];
  const scoped = /^(?:((?:NE|NW|SE|SW)\d+)[\s-]+)?(?:floor\s+(\d+)\s+)?(.+)$/i.exec(cleaned)!;
  const building = scoped[1] && canonicalBuilding(scoped[1]),
    floor = scoped[2];
  if (scoped[1] && !building) return [];
  const token = scoped[3].replace(/^room\s+/i, '');
  if (!token.trim()) return [];
  const scopedNodes = nodes.filter(
    (n) =>
      (!building || n.planId.startsWith(building + '-')) &&
      (!floor || n.planId.split('-')[1] === 'F' + floor),
  );
  const kind = new Map<string, TopologyNode['kind']>([
    ['ELEVATOR', 'elevator-stop'],
    ['LIFT', 'elevator-stop'],
    ['STAIRS', 'stair-landing'],
    ['EXTERIOR DOOR', 'outdoor-access'],
  ]).get(labelKey(token));
  if (kind)
    return scopedNodes.filter((n) => n.kind === kind).map((n) => ({ place: stop(n), nodes: [n] }));
  let query = lookupPilotLabels({
    purpose: 'destination',
    labels: [token],
    ...(building ? { building } : {}),
    ...(floor ? { floor } : {}),
  }).results[0];
  let typoCorrection: string | undefined;
  if (!query.matches.length && looksLikeIdentifier(token)) {
    const sourceLabels = new Set<string>();
    for (const page of pilotEvidence()) {
      if ((building && page.plan.building !== building) || (floor && page.plan.floor !== floor))
        continue;
      for (const label of page.byLabel.keys()) sourceLabels.add(labelKey(label));
      for (const door of page.drawnDoors) sourceLabels.add(labelKey(door.room));
    }
    const corrections = [...sourceLabels].filter(
      (label) => looksLikeIdentifier(label) && oneCharacterTypo(labelKey(token), label),
    );
    if (corrections.length === 1) {
      typoCorrection = corrections[0];
      query = lookupPilotLabels({
        purpose: 'destination',
        labels: [typoCorrection],
        ...(building ? { building } : {}),
        ...(floor ? { floor } : {}),
      }).results[0];
    }
  }
  if (query.unsupportedScope) return [];
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
  return choices.map((choice) => ({ ...choice, typoCorrection }));
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
    throw new TopologyError('Analyze a current photo from SE12, SW03 or SW01 first.', 409);
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

/** Source-bound checkpoints inside the photo hypothesis; routing uses a point only when unique. */
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
    throw new TopologyError('Analyze the current photo before requesting directions.', 409);
  const { plans, doc, network, nodes, origins } = readVisitorMap(
    candidate,
    store,
    request.networkRevision,
  );
  const vicinity = candidate.doorwayVicinity;
  const candidateBuildingPrefix = candidate.planId.split('-')[0] + '-';
  const hasBuildingCheckpoints = nodes.some((node) =>
    node.planId.startsWith(candidateBuildingPrefix),
  );
  if (!origins.length && !hasBuildingCheckpoints)
    return {
      networkRevision: doc.revision,
      origins,
      destinations: [],
      status: 'unsupported-building',
      message: `${buildingLabel(candidate.building)} does not have enough route coverage in the current pilot.`,
    };
  const published = new Map<string, PublishedCheckpoint>();
  for (const node of reviewedNetwork().nodes) published.set(node.id, node);
  const choices = resolveDestination(request.destination, nodes, network.doors, published);
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
        'No matching destination was found in the three-building pilot. Check the room number and building.',
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
      message: 'The AI could not select one destination confidently from the supplied plan labels.',
    };
  const destinationMatch = choice.typoCorrection
    ? {
        requested: request.destination,
        matched: `${planLabel(plans.find((plan) => plan.id === choice.place.planId)!)} · ${choice.place.label}`,
      }
    : undefined;
  if (!choice.nodes.length && !origins.length)
    return {
      ...context,
      ...(destinationMatch ? { destinationMatch } : {}),
      status: 'unmapped-origin-and-destination',
      message: 'The AI could not generate a route between the photo location and this destination.',
    };
  if (!choice.nodes.length)
    return {
      ...context,
      ...(destinationMatch ? { destinationMatch } : {}),
      status: 'unmapped-destination',
      message: 'No route could be generated for this destination.',
    };
  if (!origins.length)
    return {
      ...context,
      ...(destinationMatch ? { destinationMatch } : {}),
      status: 'unmapped-origin',
      message: vicinity
        ? `The AI could not continue a route from the estimated corridor outside room ${vicinity.room}. Try another photo.`
        : 'The AI could not place a route start in this photo area. Try another photo.',
    };
  const origin = request.originId
    ? origins.find((n) => n.id === request.originId)
    : origins.length === 1
      ? origins[0]
      : undefined;
  if (!origin)
    return {
      ...context,
      ...(destinationMatch ? { destinationMatch } : {}),
      status: origins.length > 1 ? 'unmapped-origin' : 'choose-origin',
      message:
        origins.length > 1
          ? 'The photo covers more than one reviewed starting point. Take a closer photo of the doorway or sign beside you.'
          : 'The exact starting point could not be identified. Try a closer photo of a mapped doorway, stair landing, or elevator.',
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
      ...(destinationMatch ? { destinationMatch } : {}),
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
    ...(destinationMatch ? { destinationMatch } : {}),
    status: 'route',
    origin,
    destination: stop(byId.get(route.nodeIds.at(-1)!)!),
    steps: removeBacktracking(steps),
  };
}

const routePointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
const generatedStopSchema = z
  .object({
    planId: z.string().min(1),
    label: z.string().trim().min(1).max(120),
    point: routePointSchema,
  })
  .strict();
const generatedStepSchema = z
  .object({
    kind: z.enum(['corridor', 'stairs', 'elevator', 'building-link', 'outdoor']),
    from: generatedStopSchema,
    to: generatedStopSchema,
    path: z.array(routePointSchema).max(100),
    instruction: z.string().trim().min(1).max(300),
    connectionId: z.string().optional(),
  })
  .strict();
const generatedRouteSchema = z
  .object({
    outcome: z.enum(['route', 'no-route']),
    explanation: z.string().trim().min(1).max(500),
    destinationId: z.string().optional(),
    origin: generatedStopSchema.optional(),
    destination: generatedStopSchema.optional(),
    steps: z.array(generatedStepSchema).max(40).optional(),
  })
  .strict();

function routeTool(planIds: string[]) {
  const point = {
    type: 'OBJECT',
    properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } },
    required: ['x', 'y'],
  };
  const stop = {
    type: 'OBJECT',
    properties: {
      planId: { type: 'STRING', enum: planIds },
      label: { type: 'STRING' },
      point,
    },
    required: ['planId', 'label', 'point'],
  };
  return {
    name: 'generate_walking_route',
    description:
      'Generate the visitor route from the supplied official floor plans. Use only the listed building connections for travel between buildings.',
    parameters: {
      type: 'OBJECT',
      properties: {
        outcome: { type: 'STRING', enum: ['route', 'no-route'] },
        explanation: { type: 'STRING' },
        destinationId: { type: 'STRING' },
        origin: stop,
        destination: stop,
        steps: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              kind: {
                type: 'STRING',
                enum: ['corridor', 'stairs', 'elevator', 'building-link', 'outdoor'],
              },
              from: stop,
              to: stop,
              path: { type: 'ARRAY', items: point },
              instruction: { type: 'STRING' },
              connectionId: { type: 'STRING' },
            },
            required: ['kind', 'from', 'to', 'path', 'instruction'],
          },
        },
      },
      required: ['outcome', 'explanation'],
    },
  };
}

function distance(a: PagePoint, b: PagePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointWithin(bounds: NonNullable<CampusLocationCandidate['bounds']>, point: PagePoint) {
  return (
    point.x >= bounds[0] && point.x <= bounds[2] && point.y >= bounds[1] && point.y <= bounds[3]
  );
}

function pointNearBounds(
  bounds: NonNullable<CampusLocationCandidate['bounds']>,
  point: PagePoint,
  padding = 0.12,
) {
  return (
    point.x >= bounds[0] - padding &&
    point.x <= bounds[2] + padding &&
    point.y >= bounds[1] - padding &&
    point.y <= bounds[3] + padding
  );
}

function generatedRouteIsValid(
  candidate: CampusLocationCandidate,
  choice: Destination,
  route: z.infer<typeof generatedRouteSchema>,
  plans: VisualPlan[],
  connectors: {
    id: string;
    kind: 'building-link' | 'outdoor';
    direction: 'forward' | 'both';
    from: TopologyNode;
    to: TopologyNode;
  }[],
) {
  const origin = route.origin,
    destination = route.destination,
    steps = route.steps;
  if (!origin || !destination || !steps?.length || !route.destinationId) return false;
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const originPlan = planById.get(origin.planId),
    destinationPlan = planById.get(destination.planId),
    requestedDestinationPlan = planById.get(choice.place.planId);
  if (
    !originPlan ||
    !destinationPlan ||
    !requestedDestinationPlan ||
    origin.planId !== candidate.planId ||
    destination.planId !== choice.place.planId ||
    originPlan.building !== candidate.building ||
    destinationPlan.building !== requestedDestinationPlan.building
  )
    return false;
  if (candidate.doorwayVicinity) {
    if (distance(origin.point, candidate.doorwayVicinity.point) > 0.025) return false;
  } else if (candidate.bounds && !pointWithin(candidate.bounds, origin.point)) return false;
  if (choice.place.point) {
    if (distance(destination.point, choice.place.point) > 0.04) return false;
  } else if (choice.place.bounds && !pointNearBounds(choice.place.bounds, destination.point)) {
    return false;
  }
  const closeStop = (
    a: z.infer<typeof generatedStopSchema>,
    b: z.infer<typeof generatedStopSchema>,
  ) => a.planId === b.planId && distance(a.point, b.point) <= 0.025;
  if (!closeStop(steps[0].from, origin) || !closeStop(steps.at(-1)!.to, destination)) return false;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index],
      fromPlan = planById.get(step.from.planId),
      toPlan = planById.get(step.to.planId);
    if (!fromPlan || !toPlan) return false;
    if (index > 0 && !closeStop(steps[index - 1].to, step.from)) return false;
    if (step.kind === 'corridor') {
      if (
        step.from.planId !== step.to.planId ||
        step.path.length < 2 ||
        distance(step.path[0], step.from.point) > 0.035 ||
        distance(step.path.at(-1)!, step.to.point) > 0.035
      )
        return false;
    } else if (step.kind === 'stairs' || step.kind === 'elevator') {
      if (fromPlan.building !== toPlan.building || fromPlan.floor === toPlan.floor) return false;
    } else {
      if (fromPlan.building === toPlan.building || !step.connectionId) return false;
      const connector = connectors.find((item) => item.id === step.connectionId);
      if (
        !connector ||
        connector.kind !== step.kind ||
        !(
          (closeStop(step.from, {
            planId: connector.from.planId,
            label: connector.from.label,
            point: connector.from.point,
          }) &&
            closeStop(step.to, {
              planId: connector.to.planId,
              label: connector.to.label,
              point: connector.to.point,
            })) ||
          (connector.direction === 'both' &&
            closeStop(step.from, {
              planId: connector.to.planId,
              label: connector.to.label,
              point: connector.to.point,
            }) &&
            closeStop(step.to, {
              planId: connector.from.planId,
              label: connector.from.label,
              point: connector.from.point,
            }))
        )
      )
        return false;
    }
  }
  return true;
}

function generatedStop(stopValue: z.infer<typeof generatedStopSchema>): MapStop {
  return { ...stopValue, id: randomUUID() };
}

/** Use AI to locate route endpoints and draw floor-local legs; only inter-building links are fixed inputs. */
export async function planAiVisitorJourney(
  candidate: CampusLocationCandidate,
  request: NavigationChoice,
  store: TopologyStore,
  provider: Provider,
  onAttempt?: () => void,
): Promise<NavigationResult> {
  if (candidate.id !== request.candidateId)
    throw new TopologyError('Analyze the current photo before requesting directions.', 409);
  const { plans, doc, network, nodes } = readVisitorMap(candidate, store, request.networkRevision);
  const published = new Map<string, PublishedCheckpoint>();
  for (const node of reviewedNetwork().nodes) published.set(node.id, node);
  const choices = resolveDestination(request.destination, nodes, network.doors, published);
  const destinations = choices.map((choice) => choice.place);
  if (!choices.length)
    return {
      networkRevision: doc.revision,
      origins: [],
      destinations,
      status: 'unknown-destination',
      message: 'The destination did not match a room on the supplied pilot floor plans.',
    };

  const eligibleEdges = new Set(network.allowed);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connectors = doc.edges.flatMap((edge) => {
    if (!eligibleEdges.has(edge.id) || (edge.kind !== 'building-link' && edge.kind !== 'outdoor'))
      return [];
    const from = nodeById.get(edge.fromNodeId),
      to = nodeById.get(edge.toNodeId);
    if (
      !from ||
      !to ||
      store.plans.find((p) => p.id === from.planId)?.building ===
        store.plans.find((p) => p.id === to.planId)?.building
    )
      return [];
    return [{ id: edge.id, kind: edge.kind, direction: edge.direction, from, to }];
  });
  const participatingBuildings = new Set([
    candidate.building,
    ...choices.map(
      (choice) => store.plans.find((plan) => plan.id === choice.place.planId)?.building,
    ),
  ]);
  const targetPlanIds = new Set(choices.map((choice) => choice.place.planId));
  const samePageRoute = targetPlanIds.size === 1 && targetPlanIds.has(candidate.planId);
  const routePlans = plans.filter((plan) =>
    samePageRoute ? plan.id === candidate.planId : participatingBuildings.has(plan.building),
  );
  const planIds = routePlans.map((plan) => plan.id);
  const tool = routeTool(planIds);
  const destinationContext = choices.map((choice) => ({
    id: choice.place.id,
    planId: choice.place.planId,
    label: choice.place.label,
    ...(choice.place.bounds ? { bounds: choice.place.bounds } : {}),
    ...(choice.place.point ? { point: choice.place.point } : {}),
  }));
  const startContext = candidate.doorwayVicinity
    ? {
        planId: candidate.planId,
        label: `outside room ${candidate.doorwayVicinity.room}`,
        point: candidate.doorwayVicinity.point,
      }
    : { planId: candidate.planId, bounds: candidate.bounds };
  const connectorContext = connectors.map((connector) => ({
    id: connector.id,
    kind: connector.kind,
    direction: connector.direction,
    from: {
      planId: connector.from.planId,
      label: connector.from.label,
      point: connector.from.point,
    },
    to: {
      planId: connector.to.planId,
      label: connector.to.label,
      point: connector.to.point,
    },
  }));
  const contents = [
    {
      role: 'user' as const,
      parts: [
        {
          text: `Find a route from this photo-derived starting area to the requested destination. The destination text is ${JSON.stringify(request.destination)}. Starting area: ${JSON.stringify(startContext)}. Destination candidates read from the official plans: ${JSON.stringify(destinationContext)}. Official building connections that are allowed between buildings: ${JSON.stringify(connectorContext)}. Supplied floor-plan IDs: ${JSON.stringify(planIds)}. Choose the most plausible matching destination candidate. On each floor, route through corridors and doorways shown in the image; never draw through a room or wall. You may use stairs or elevators by matching their visible locations across plans in the same building. To change buildings, use an allowed building connection exactly as listed and provide its connectionId; never invent an outdoor path or building passage. Return normalized whole-page coordinates from 0 to 1. The origin must lie inside the supplied starting bounds (or match the supplied doorway point); the destination must be at the selected room's doorway near its printed label. Each corridor step needs an ordered path from its from point to its to point. Transfer steps have an empty path. Do not ask the visitor to confirm anything. If the plans do not show a plausible continuous route, return outcome no-route.`,
        },
        ...routePlans.flatMap((plan) => [
          {
            text: `Official BCIT source plan ${plan.id}, building ${plan.building}, floor ${plan.floor}. Use this page's normalized top-left coordinate system.`,
          },
          planImagePart(plan.overview),
        ]),
      ],
    },
  ];
  const response = await provider.generate(
    contents,
    [tool],
    AbortSignal.timeout(30_000),
    onAttempt,
    {
      forceTool: tool.name,
      maxOutputTokens: 8192,
      thinkingLevel: 'low',
      timeoutMs: 25_000,
    },
  );
  const calls = response.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
  const parsed = generatedRouteSchema.safeParse(
    calls.length === 1 && calls[0].name === tool.name ? calls[0].args : null,
  );
  const networkRevision = doc.revision;
  const noRoute = (message: string): NavigationResult => ({
    networkRevision,
    origins: [],
    destinations,
    status: 'no-route',
    message,
  });
  if (!parsed.success)
    return noRoute('The AI could not find a confident route from the supplied floor plans.');
  if (parsed.data.outcome === 'no-route')
    return noRoute('The AI could not find a continuous route in the supplied floor plans.');
  const choice = choices.find((item) => item.place.id === parsed.data.destinationId);
  if (!choice || !generatedRouteIsValid(candidate, choice, parsed.data, routePlans, connectors))
    return noRoute('The proposed route did not match the supplied floor plans and building links.');

  const origin = generatedStop(parsed.data.origin!),
    destination = generatedStop(parsed.data.destination!);
  const steps: WalkingStep[] = [];
  for (let index = 0; index < parsed.data.steps!.length; index++) {
    const step = parsed.data.steps![index];
    const from = index === 0 ? origin : steps[index - 1].to;
    const to = index === parsed.data.steps!.length - 1 ? destination : generatedStop(step.to);
    steps.push({ kind: step.kind, from, to, path: step.path, instruction: step.instruction });
  }
  const destinationMatch = choice.typoCorrection
    ? {
        requested: request.destination,
        matched: `${planLabel(routePlans.find((plan) => plan.id === choice.place.planId)!)} · ${choice.place.label}`,
      }
    : undefined;
  return {
    networkRevision,
    origins: [origin],
    destinations,
    ...(destinationMatch ? { destinationMatch } : {}),
    status: 'route',
    origin,
    destination,
    steps,
  };
}
