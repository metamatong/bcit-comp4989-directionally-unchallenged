import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readJson, root } from '../server/data';
import { visualPlans, planAtlases } from '../server/visual-data';
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
