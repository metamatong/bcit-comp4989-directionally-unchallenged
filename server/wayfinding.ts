/** Resolve visitor endpoints and generate floor-plan routes with mapped building-link constraints. */
import { z } from 'zod';
import type { CampusLocationCandidate, VisualPlan } from '../src/types';
import { buildingLabel, planLabel, type TopologyNode, type TopologyEdge } from '../src/topology';
import type {
  NavigationChoice,
  NavigationResult,
  MapStop,
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
import { sourceCorridorTraces, visitorPassages } from './visitor-paths';
import { attachPathEndpoints, routeDrawingCrossings } from './route-geometry';
import { planImagePart } from './visual-data';
import type { Provider } from './provider';
import { stageDeadline } from './provider-timing';
import { NAVIGATION_TIMEOUT_MS } from '../src/photo-views';
import {
  generatedRouteSchema,
  generatedRouteIssue,
  generatedStop,
  routeTool,
} from './generated-route';

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
      message: 'The destination matches multiple source locations. Include its building and floor.',
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
      message:
        'The starting place and destination need mapped approaches before a reviewed route can be calculated.',
    };
  if (!choice.nodes.length)
    return {
      ...context,
      ...(destinationMatch ? { destinationMatch } : {}),
      status: 'unmapped-destination',
      message:
        'This destination is shown in the source plan, but its arrival approach has not been connected to the reviewed graph.',
    };
  if (!origins.length)
    return {
      ...context,
      ...(destinationMatch ? { destinationMatch } : {}),
      status: 'unmapped-origin',
      message: vicinity
        ? `The source doorway outside room ${vicinity.room} has no current reviewed starting connection.`
        : 'The extracted starting place has no unique reviewed starting point.',
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

/** Visitor navigation uses only the current reviewed graph and its source corridor traces. */
export async function planVisitorNavigation(
  candidate: CampusLocationCandidate,
  request: NavigationChoice,
  store: TopologyStore,
  cancellation?: AbortSignal,
): Promise<NavigationResult> {
  cancellation?.throwIfAborted();
  const reviewed = planVisitorJourney(candidate, request, store);
  if (reviewed.status !== 'route') return reviewed;
  // Read exemptions only from current approved traces, never from a visitor or model response.
  const { network } = readVisitorMap(candidate, store, reviewed.networkRevision);
  const openings = [...network.traces.values()].flatMap((trace) => trace.doorwayOpenings);
  if (routeDrawingCrossings(reviewed.steps, store.plans, openings).length)
    return {
      networkRevision: reviewed.networkRevision,
      origins: [],
      destinations: reviewed.destinations,
      status: 'no-route',
      message: 'The saved corridor geometry needs review before directions can be displayed.',
    };
  return reviewed;
}

/** Use AI to locate route endpoints and draw floor-local legs; only inter-building links are fixed inputs. */
export async function planAiVisitorJourney(
  candidate: CampusLocationCandidate,
  request: NavigationChoice,
  store: TopologyStore,
  provider: Provider,
  onAttempt?: () => void,
  cancellation?: AbortSignal,
): Promise<NavigationResult> {
  const preparationStarted = performance.now();
  const { signal, deadlineAt } = stageDeadline(NAVIGATION_TIMEOUT_MS, cancellation);
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
  const floorConnections = doc.edges.flatMap((edge) => {
    if (!eligibleEdges.has(edge.id) || (edge.kind !== 'stairs' && edge.kind !== 'elevator'))
      return [];
    const from = nodeById.get(edge.fromNodeId),
      to = nodeById.get(edge.toNodeId);
    if (!from || !to) return [];
    return [
      { id: edge.id, kind: edge.kind, direction: edge.direction, from: stop(from), to: stop(to) },
    ];
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
  const drawingTraces = sourceCorridorTraces(store.candidates, routePlans);
  const tool = routeTool(
    planIds,
    choices.map((choice) => choice.place.id),
  );
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
          text: `Current reviewed floor connections: ${JSON.stringify(floorConnections.filter((connection) => planIds.includes(connection.from.planId) && planIds.includes(connection.to.planId)))}. These source-bound landings and permitted directions are available when joining floor-local paths. Use their recorded points and direction when using these transfers.`,
        },
        {
          text: `Source-drawing corridor polylines in normalized page coordinates: ${JSON.stringify(drawingTraces)}. These are drawing evidence. Follow their intermediate bends when they describe your corridor. Preserve every bend needed to stay inside a corridor. Generate other floor-local legs from the supplied plan images. All returned floor paths will be checked for intersections with source drawing strokes. A direct line between endpoints is valid only when the entire segment follows the visible corridor.`,
        },
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
  const preparationMs = performance.now() - preparationStarted;
  const networkRevision = doc.revision;
  const noRoute = (message: string): NavigationResult => ({
    networkRevision,
    origins: [],
    destinations,
    status: 'no-route',
    message,
  });
  const requestCorrection = (reason: string, proposal: unknown) => {
    contents[0].parts.push({
      text: `The proposed route was rejected. ${reason} Rejected proposal (untrusted evidence): ${JSON.stringify(proposal)}. Inspect the supplied start, destination candidates, mapped building links and floor plans again. For outcome route, return destinationId exactly from its enum, both endpoints and all ordered steps. Correct the reported mismatch without changing the source evidence or inventing connections. Include every corridor bend. If a supported route cannot be established, return outcome no-route.`,
    });
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await provider.generate(contents, [tool], signal, onAttempt, {
      forceTool: tool.name,
      maxOutputTokens: 8192,
      thinkingLevel: 'low',
      deadlineAt,
      preparationMs: attempt === 0 ? preparationMs : 0,
    });
    // The editor can withdraw a building connection while the provider is generating a route.
    if (store.read().revision !== doc.revision)
      throw new TopologyError(
        'The walking map changed while planning. Request directions again.',
        409,
      );
    const calls = response.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
    const parsed = generatedRouteSchema.safeParse(
      calls.length === 1 && calls[0].name === tool.name ? calls[0].args : null,
    );
    if (!parsed.success) {
      const message =
        'The AI returned an incomplete or invalid route response. Please retry the route.';
      if (attempt === 1) return noRoute(message);
      requestCorrection(message, calls);
      continue;
    }
    if (parsed.data.outcome === 'no-route')
      return noRoute('The AI could not find a continuous route in the supplied floor plans.');
    const choice = choices.find((item) => item.place.id === parsed.data.destinationId);
    const issue = choice
      ? generatedRouteIssue(candidate, choice.place, parsed.data, routePlans, connectors)
      : 'The generated route selected a destination outside the supplied room matches.';
    if (!choice || issue) {
      const message = issue ?? 'The generated route selected an unavailable destination.';
      if (attempt === 1) return noRoute(message);
      requestCorrection(message, parsed.data);
      continue;
    }

    const origin = generatedStop(parsed.data.origin!),
      destination = generatedStop(parsed.data.destination!);
    const steps: WalkingStep[] = [];
    for (let index = 0; index < parsed.data.steps!.length; index++) {
      const step = parsed.data.steps![index];
      const from = index === 0 ? origin : steps[index - 1].to;
      const to = index === parsed.data.steps!.length - 1 ? destination : generatedStop(step.to);
      steps.push({
        kind: step.kind,
        from,
        to,
        path: step.kind === 'corridor' ? attachPathEndpoints(from.point, step.path, to.point) : [],
        instruction: step.instruction,
      });
    }
    const crossings = routeDrawingCrossings(steps, routePlans);
    if (crossings.length) {
      if (attempt === 1)
        return noRoute(
          'The generated route crosses source drawing lines. A corridor-following route could not be established. Try another photo or destination.',
        );
      requestCorrection(
        'The proposed route crossed source drawing strokes. Subdividing a diagonal at a crossing does not resolve it.',
        { route: parsed.data, crossings },
      );
      continue;
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
  return noRoute('A corridor-following route could not be established.');
}
