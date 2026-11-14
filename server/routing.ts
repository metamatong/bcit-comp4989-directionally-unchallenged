import type { VisualPlan } from '../src/types';
import type {
  TopologyDocument,
  TopologyEdge,
  TopologyRoute,
  TopologyRouteRequest,
} from '../src/topology';
import { TopologyError, topologyEligibility, topologyPlans } from './topology';

/** Dijkstra over approved topology only. Page coordinates never supply route costs. */
export function computeTopologyRoute(
  document: TopologyDocument,
  request: TopologyRouteRequest,
  plans: VisualPlan[] = topologyPlans,
  displayableEdgeIds?: ReadonlySet<string>,
): TopologyRoute {
  if (request.revision !== document.revision)
    throw new TopologyError('The graph changed. Reload it before calculating another route.', 409);
  const { fromNodeId, toNodeId, mode } = request;
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  if (!nodes.has(fromNodeId) || !nodes.has(toNodeId))
    throw new TopologyError('Choose two saved route endpoints.');
  const eligibility = topologyEligibility(document, plans);
  const eligibleNodes = new Set(eligibility.nodeIds),
    eligibleEdges = new Set(eligibility.edgeIds);
  const noRoute: TopologyRoute = {
    revision: document.revision,
    mode,
    outcome: 'no-route',
    nodeIds: [],
    edgeIds: [],
    distanceMeters: null,
    message:
      'No route exists in the eligible graph. Add or review the missing passages; no connection was inferred.',
  };
  if (!eligibleNodes.has(fromNodeId) || !eligibleNodes.has(toNodeId))
    return { ...noRoute, message: 'Both route endpoints need current approval.' };
  const adjacency = new Map<string, { next: string; edge: TopologyEdge; cost: number }[]>();
  for (const edge of document.edges) {
    if (
      !eligibleEdges.has(edge.id) ||
      (displayableEdgeIds && !displayableEdgeIds.has(edge.id)) ||
      (mode === 'measured-distance' && edge.distanceMeters === null)
    )
      continue;
    const cost = mode === 'measured-distance' ? edge.distanceMeters! : 1;
    const add = (from: string, to: string) => {
      const neighbors = adjacency.get(from) ?? [];
      neighbors.push({ next: to, edge, cost });
      adjacency.set(from, neighbors);
    };
    add(edge.fromNodeId, edge.toNodeId);
    if (edge.direction === 'both') add(edge.toNodeId, edge.fromNodeId);
  }
  const costs = new Map<string, number>([[fromNodeId, 0]]);
  const previous = new Map<string, { nodeId: string; edge: TopologyEdge }>();
  const frontier = [{ nodeId: fromNodeId, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => b.cost - a.cost);
    const current = frontier.pop()!;
    if (current.cost !== costs.get(current.nodeId)) continue;
    if (current.nodeId === toNodeId) break;
    for (const neighbor of adjacency.get(current.nodeId) ?? []) {
      const cost = current.cost + neighbor.cost;
      if (cost >= (costs.get(neighbor.next) ?? Infinity)) continue;
      costs.set(neighbor.next, cost);
      previous.set(neighbor.next, { nodeId: current.nodeId, edge: neighbor.edge });
      frontier.push({ nodeId: neighbor.next, cost });
    }
  }
  if (!costs.has(toNodeId))
    return mode === 'measured-distance'
      ? {
          ...noRoute,
          message:
            'No route has a reviewed distance on every connection. Unknown distances were excluded, not estimated.',
        }
      : noRoute;
  const nodeIds = [toNodeId],
    edges: TopologyEdge[] = [];
  while (nodeIds[0] !== fromNodeId) {
    const step = previous.get(nodeIds[0])!;
    nodeIds.unshift(step.nodeId);
    edges.unshift(step.edge);
  }
  return {
    revision: document.revision,
    mode,
    outcome: 'route',
    nodeIds,
    edgeIds: edges.map((edge) => edge.id),
    distanceMeters: edges.every((edge) => edge.distanceMeters !== null)
      ? edges.reduce((total, edge) => total + edge.distanceMeters!, 0)
      : null,
    message:
      mode === 'measured-distance'
        ? 'Shortest recorded distance within the approved, measured network only. Unmeasured alternatives and live conditions are unknown.'
        : 'Fewest recorded connections within the approved graph. This is not a shortest walking-distance or travel-time claim.',
  };
}
