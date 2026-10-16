import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readJson, root } from '../server/data';
import { visualPlans, planAtlases, planGeometrySummary } from '../server/visual-data';
import { roomLabelIndex } from '../server/room-labels';
const manifest = readJson<{
  sources: { id: string; file: string; sha256: string; campus: string }[];
}>('data/campus/manifest.json');
for (const source of manifest.sources) {
  if (
    source.campus !== 'Burnaby' ||
    createHash('sha256')
      .update(readFileSync(`${root}/${source.file}`))
      .digest('hex') !== source.sha256
  )
    throw new Error(`Invalid source: ${source.file}`);
}
console.log(`Validated ${manifest.sources.length} official Burnaby source hashes.`);
let assetCount = 0;
for (const plan of visualPlans) {
  for (const asset of [plan.full, plan.overview, ...plan.tiles, plan.geometry]) {
    if (
      createHash('sha256')
        .update(readFileSync(`${root}/${asset.file}`))
        .digest('hex') !== asset.sha256
    )
      throw new Error(`Visual asset hash mismatch: ${asset.file}`);
    assetCount++;
  }
  const geometry = readJson<{
    id: string;
    sourceSha256: string;
    longSegments: { coordinates: number[] }[];
    routingEdges: unknown[];
  }>(plan.geometry.file);
  if (
    geometry.id !== plan.id ||
    geometry.sourceSha256 !== plan.sourceSha256 ||
    geometry.routingEdges.length
  )
    throw new Error(`Invalid geometry provenance or invented routing: ${plan.id}`);
  if (
    geometry.longSegments.some(
      (segment) =>
        segment.coordinates.length !== 4 ||
        segment.coordinates.some((value) => !Number.isFinite(value) || value < 0 || value > 1),
    )
  )
    throw new Error(`Invalid geometry coordinates: ${plan.id}`);
}
for (const atlas of planAtlases) {
  if (
    createHash('sha256')
      .update(readFileSync(`${root}/${atlas.file}`))
      .digest('hex') !== atlas.sha256
  )
    throw new Error(`Overview hash mismatch: ${atlas.id}`);
  assetCount++;
}
if (visualPlans.length !== 89)
  throw new Error('Expected visual coverage for all 89 downloaded Burnaby floor plans.');
console.log(
  `Validated ${visualPlans.length} source-linked geometry records and ${assetCount} generated asset hashes.`,
);

const labelCount = visualPlans.reduce(
  (total, plan) => total + planGeometrySummary(plan).labels.length,
  0,
);
if (roomLabelIndex().labelCount !== labelCount)
  throw new Error('The room label index omits source labels.');
console.log(`Indexed all ${labelCount} extracted source labels for exact identifier lookup.`);

const routeGraph = readJson<{
  sourceRef: string;
  mapImage: {
    file: string;
    url: string;
    width: number;
    height: number;
    sha256: string;
    sourceId: string;
    sourceRef: string;
    sourceSha256: string;
    cropRenderedPixels: [number, number, number, number];
  };
  nodes: { id: string; mapPoint: [number, number] }[];
  edges: {
    id: string;
    from: string;
    to: string;
    sourceRef: string;
    path: [number, number][];
  }[];
}>('data/campus/graph.json');
const routeCoverage = readJson<{
  sourceTracedRouteNodes: number;
  sourceTracedRouteEdges: number;
}>('data/campus/coverage.json');
const wayfinding = manifest.sources.find(
  (source) => source.file === 'data/campus/raw/bcit_wayfinding.pdf',
);
if (!wayfinding || routeGraph.sourceRef !== 'burnaby-wayfinding#page=1')
  throw new Error('The campus route graph does not reference the official Burnaby wayfinding map.');
const mapImage = routeGraph.mapImage;
const mapPath = `${root}/${mapImage.file}`;
if (
  mapImage.file !== 'data/campus/visual/campus-wayfinding-central.png' ||
  mapImage.sourceId !== wayfinding.id ||
  mapImage.sourceRef !== routeGraph.sourceRef ||
  mapImage.sourceSha256 !== wayfinding.sha256 ||
  mapImage.url !== `/${mapImage.file}` ||
  mapImage.width !== mapImage.cropRenderedPixels[2] - mapImage.cropRenderedPixels[0] ||
  mapImage.height !== mapImage.cropRenderedPixels[3] - mapImage.cropRenderedPixels[1] ||
  mapImage.cropRenderedPixels[2] > 1100 ||
  mapImage.cropRenderedPixels[3] > 1700 ||
  createHash('sha256').update(readFileSync(mapPath)).digest('hex') !== mapImage.sha256
)
  throw new Error(
    'The central campus route map image has invalid dimensions or source provenance.',
  );
assetCount++;
const routeNodeIds = new Set(routeGraph.nodes.map((node) => node.id));
if (
  routeNodeIds.size !== routeGraph.nodes.length ||
  routeGraph.nodes.some(
    (node) =>
      node.mapPoint.length !== 2 ||
      node.mapPoint.some(
        (coordinate) => !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1,
      ),
  ) ||
  new Set(routeGraph.edges.map((edge) => edge.id)).size !== routeGraph.edges.length ||
  routeGraph.edges.some(
    (edge) =>
      !routeNodeIds.has(edge.from) ||
      !routeNodeIds.has(edge.to) ||
      edge.from === edge.to ||
      edge.sourceRef !== routeGraph.sourceRef ||
      edge.path.length < 2 ||
      edge.path.some(
        (point) =>
          point.length !== 2 ||
          point.some(
            (coordinate) => !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1,
          ),
      ) ||
      JSON.stringify(edge.path[0]) !==
        JSON.stringify(routeGraph.nodes.find((node) => node.id === edge.from)?.mapPoint) ||
      JSON.stringify(edge.path.at(-1)) !==
        JSON.stringify(routeGraph.nodes.find((node) => node.id === edge.to)?.mapPoint),
  )
)
  throw new Error('The campus route graph contains duplicate or invalid map-linked records.');
const routeAdjacency = new Map<string, string[]>();
for (const edge of routeGraph.edges) {
  routeAdjacency.set(edge.from, [...(routeAdjacency.get(edge.from) ?? []), edge.to]);
  routeAdjacency.set(edge.to, [...(routeAdjacency.get(edge.to) ?? []), edge.from]);
}
const reached = new Set<string>();
const queue = routeGraph.nodes.length ? [routeGraph.nodes[0].id] : [];
while (queue.length) {
  const current = queue.shift()!;
  if (reached.has(current)) continue;
  reached.add(current);
  queue.push(...(routeAdjacency.get(current) ?? []));
}
if (!routeGraph.nodes.length || reached.size !== routeGraph.nodes.length)
  throw new Error('The source-traced pilot route graph is empty or disconnected.');
if (
  routeCoverage.sourceTracedRouteNodes !== routeGraph.nodes.length ||
  routeCoverage.sourceTracedRouteEdges !== routeGraph.edges.length
)
  throw new Error('The campus route summary does not match the source-traced graph.');
console.log(
  `Validated ${routeGraph.nodes.length} source-traced outdoor route nodes, ${routeGraph.edges.length} visual segments, and the map overlay image.`,
);
