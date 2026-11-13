import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readJson, root } from '../server/data';
import { visualPlans, planAtlases, planGeometrySummary } from '../server/visual-data';
import { retrieveRoomLabels, roomLabelIndex } from '../server/room-labels';
import { pilotCoverage } from '../server/spatial-retrieval';
import { pilotEvidence } from '../server/pilot-evidence';
import { reviewedNetwork } from '../server/pilot-network';
const manifest = readJson<{ sources: { file: string; sha256: string; campus: string }[] }>(
  'data/campus/manifest.json',
);
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
const pilot = pilotCoverage();
const planRead = pilot.reduce((count, page) => count + page.planReadLabels, 0);
if (roomLabelIndex().labelCount !== labelCount)
  throw new Error('The room label index omits source labels.');
const pilotCount = pilot.reduce((sum, p) => sum + p.geometryLabels, 0);
const drawingCount = pilotEvidence().reduce(
  (sum, p) =>
    sum +
    p.observations.filter((o) => o.context === 'drawing' && o.disposition === 'candidate').length,
  0,
);
const photoCount = retrieveRoomLabels([], new Set()).indexedLabels;
if (photoCount !== labelCount - pilotCount + drawingCount)
  throw new Error('Incomplete photo drawing index.');
console.log(
  `Indexed all ${labelCount} original source labels. Photo retrieval covers ${photoCount} drawing observations, including ${planRead} transcriptions.`,
);
const network = reviewedNetwork();
console.log(
  `Pilot RAG: ${pilot.length} pages, ${pilot.reduce((sum, page) => sum + page.ocrWords, 0)} OCR observations; approved network revision ${network.revision}, ${network.nodes.length} points, ${network.edges.length} passages.`,
);
