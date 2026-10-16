import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { readJson, root } from './data';
import type { CampusRoute, RoutePoint } from '../src/types';
import { normalizeRoomLabel, roomLabelIndex } from './room-labels';

const routePointSchema = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
]);
const routeNodeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(['building-vicinity', 'mapped-landmark']),
    building: z.string().min(1).optional(),
    mapPoint: routePointSchema,
  })
  .strict();
const routeEdgeSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    path: z.array(routePointSchema).min(2),
    sourceRef: z.string().min(1),
    accessibility: z.literal('unknown'),
  })
  .strict();
const mapImageSchema = z
  .object({
    file: z.string(),
    url: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceId: z.string().min(1),
    sourceRef: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    renderDpi: z.number().positive(),
    cropRenderedPixels: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
  })
  .strict();
const routeGraphSchema = z
  .object({
    id: z.string().min(1),
    campus: z.literal('Burnaby'),
    sourceRef: z.string().min(1),
    status: z.string().min(1),
    attribution: z.string().min(1),
    mapImage: mapImageSchema,
    nodes: z.array(routeNodeSchema).min(2),
    edges: z.array(routeEdgeSchema).min(1),
    limitations: z.array(z.string().min(1)).min(1),
  })
  .strict();
const graph = routeGraphSchema.parse(readJson<unknown>('data/campus/graph.json'));
type RouteEdge = z.infer<typeof routeEdgeSchema>;
const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
const visualRoot = resolve(root, 'data/campus/visual');
const mapPath = resolve(root, graph.mapImage.file);

if (
  !mapPath.startsWith(visualRoot + sep) ||
  graph.mapImage.url !== `/${graph.mapImage.file}` ||
  nodesById.size !== graph.nodes.length ||
  new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length ||
  graph.edges.some((edge) => {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    return (
      !from ||
      !to ||
      edge.from === edge.to ||
      edge.sourceRef !== graph.sourceRef ||
      JSON.stringify(edge.path[0]) !== JSON.stringify(from.mapPoint) ||
      JSON.stringify(edge.path.at(-1)) !== JSON.stringify(to.mapPoint)
    );
  })
)
  throw new Error('Campus directions graph contains duplicate nodes or invalid map connections.');

const mapBytes = readFileSync(mapPath);
if (createHash('sha256').update(mapBytes).digest('hex') !== graph.mapImage.sha256)
  throw new Error('The campus route map changed. Regenerate the visual map before serving routes.');

export const directionCatalogue = {
  available: graph.nodes.length > 1 && graph.edges.length > 0,
  nodes: graph.nodes,
  segmentCount: graph.edges.length,
  mapImage: graph.mapImage,
  sourceRef: graph.sourceRef,
  status: graph.status,
  limitations: graph.limitations,
};

type CampusDestination = {
  kind: 'mapped-location' | 'room-label';
  label: string;
  building?: string;
  floor?: string;
  sourceRef?: string;
};
type ResolvedCampusDestination =
  | { kind: 'mapped-location'; nodeId: string; resolution: CampusDestination }
  | { kind: 'room-label'; nodeId: string; resolution: CampusDestination }
  | { kind: 'unmapped-room-label'; resolution: CampusDestination };

export function resolveCampusDestination(query: string): ResolvedCampusDestination {
  const normalizedQuery = normalizeRoomLabel(query);
  const directNode = graph.nodes.find(
    (node) =>
      normalizeRoomLabel(node.label) === normalizedQuery ||
      (node.kind === 'building-vicinity' && node.building === normalizedQuery),
  );
  if (directNode)
    return {
      kind: 'mapped-location',
      nodeId: directNode.id,
      resolution: { kind: 'mapped-location', label: directNode.label },
    };

  const roomQuery = normalizedQuery.match(
    /^(NE|NW|SE|SW)\s*(\d+)(?:\s+(?:FLOOR|F)\s*(\d+))?\s+(.+)$/,
  );
  const building = roomQuery ? `${roomQuery[1]}${roomQuery[2]}` : undefined;
  const floor = roomQuery?.[3];
  const label = (roomQuery ? roomQuery[4] : normalizedQuery).replace(/^ROOM\s+/, '');
  const plans = [
    ...new Map(
      roomLabelIndex()
        .find(label)
        .filter(
          (record) =>
            (!building || record.building === building) && (!floor || record.floor === floor),
        )
        .map((record) => [record.planId, record]),
    ).values(),
  ];
  if (!plans.length)
    throw new Error(
      'No exact source-plan label found. Try the room number with its building code.',
    );
  if (plans.length > 1) {
    const multipleBuildings = new Set(plans.map((record) => record.building)).size > 1;
    const multipleFloors = new Set(plans.map((record) => record.floor)).size > 1;
    throw new Error(
      multipleBuildings
        ? 'This label appears in multiple buildings. Include its building code, for example “SE12 302”.'
        : multipleFloors
          ? 'This label appears on multiple floors. Include the floor, for example “SE12 Floor 3 302”.'
          : 'This label appears on multiple plans. Include the building, floor, and room number.',
    );
  }

  const plan = plans[0];
  const node = graph.nodes.find(
    (candidate) => candidate.kind === 'building-vicinity' && candidate.building === plan.building,
  );
  const resolution: CampusDestination = {
    kind: 'room-label',
    label: `${plan.building} · Floor ${plan.floor} · Room ${plan.text}`,
    building: plan.building,
    floor: plan.floor,
    sourceRef: plan.sourceRef,
  };
  return node
    ? { kind: 'room-label', nodeId: node.id, resolution }
    : { kind: 'unmapped-room-label', resolution };
}

export function routeCampus(fromNodeId: string, toNodeId: string): CampusRoute {
  const start = nodesById.get(fromNodeId);
  const destination = nodesById.get(toNodeId);
  if (!start || !destination)
    throw new Error('Choose a start and destination from the mapped list.');
  if (start.id === destination.id) throw new Error('Choose two different mapped locations.');

  const adjacency = new Map<string, { nodeId: string; edge: RouteEdge }[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { nodeId: edge.to, edge }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { nodeId: edge.from, edge }]);
  }

  const previous = new Map<string, { nodeId: string; edge: RouteEdge }>();
  const visited = new Set([start.id]);
  const queue = [start.id];
  for (let index = 0; index < queue.length && !visited.has(destination.id); index++) {
    const currentId = queue[index];
    for (const next of adjacency.get(currentId) ?? []) {
      if (visited.has(next.nodeId)) continue;
      visited.add(next.nodeId);
      previous.set(next.nodeId, { nodeId: currentId, edge: next.edge });
      queue.push(next.nodeId);
    }
  }
  if (!visited.has(destination.id))
    throw new Error('No source-mapped walking route connects those locations.');

  const segments: CampusRoute['segments'] = [];
  for (let currentId = destination.id; currentId !== start.id;) {
    const prior = previous.get(currentId);
    if (!prior) throw new Error('The mapped route could not be reconstructed.');
    const points: RoutePoint[] =
      prior.edge.from === prior.nodeId ? prior.edge.path : [...prior.edge.path].reverse();
    segments.unshift({ edgeId: prior.edge.id, points, sourceRef: prior.edge.sourceRef });
    currentId = prior.nodeId;
  }

  return {
    graphId: graph.id,
    start,
    destination,
    segments,
    sourceRef: graph.sourceRef,
    limitations: graph.limitations,
  };
}
