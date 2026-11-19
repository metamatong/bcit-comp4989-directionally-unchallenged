/** Emit Vercel Build Output v3 from verified official assets and the existing Express app. */
import { createHash } from 'node:crypto';
import { cp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import { root, readJson } from '../server/data';
import {
  planGeometrySummary,
  planDrawingSegments,
  preparedGeometryPath,
  visualPlans,
  planAtlases,
} from '../server/visual-data';
import { reviewedNetwork } from '../server/pilot-network';
import { readConnectionCandidates } from '../server/topology-candidates';
import { importReviewedNetwork } from '../server/topology-import';

const output = join(root, '.vercel/output');
const functionDir = join(output, 'functions/api.func');
const staticDir = join(output, 'static');
async function copyIntoFunction(path: string) {
  const destination = join(functionDir, path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, path), destination);
}

async function packageCampusData() {
  const files = [
    'catalogue.json',
    'coverage.json',
    'manifest.json',
    'connection-candidates.json',
    'topology-english-migration.json',
    'geolocation/calibrations.json',
    'geolocation/bcit-burnaby-footprints.json',
    'spatial/floor-circulation.json',
    'spatial/floor-graphs.json',
    'spatial/floor-graphs.sha256',
    'spatial/pilot-ocr.json',
    'spatial/pilot-ocr.sha256',
    'spatial/plan-annotations.json',
    'spatial/reviewed-network.json',
    'spatial/reviewed-network.sha256',
    'spatial/passage-inquiries.json',
    'spatial/corridor-traces.json',
    'spatial/corridor-traces.sha256',
    'visual/index.json',
  ];
  for (const file of files) await copyIntoFunction('data/campus/' + file);
  for (const plan of visualPlans)
    for (const image of [plan.full, plan.overview, ...plan.tiles])
      await copyIntoFunction(image.file);
  for (const atlas of planAtlases) await copyIntoFunction(atlas.file);

  const summaries = visualPlans.map((plan) => ({
    sourceSha256: plan.sourceSha256,
    geometrySha256: plan.geometry.sha256,
    summary: planGeometrySummary(plan),
    drawingSegments: planDrawingSegments(plan),
  }));
  const bytes = Buffer.from(JSON.stringify(summaries));
  await writeFile(join(functionDir, preparedGeometryPath), bytes);
  // An operator's local editor file may hold private review history. Always reconstruct from the public snapshot.
  const graph = importReviewedNetwork(reviewedNetwork(), readConnectionCandidates());
  await writeFile(join(functionDir, 'data/campus/topology.json'), JSON.stringify(graph));
  console.log(
    'Packaged ' + summaries.length + ' verified plan summaries (' + bytes.length + ' bytes).',
  );
  return createHash('sha256').update(bytes).digest('hex');
}

async function packageServer(digest: string) {
  const artifact = await build({
    entryPoints: [join(root, 'server/vercel.ts')],
    outfile: join(functionDir, 'server/entry.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    metafile: true,
    define: { HOSTED_GEOMETRY_DIGEST: JSON.stringify(digest) },
  });
  const imports = Object.values(artifact.metafile.outputs)
    .flatMap((file) => file.imports)
    .filter((dependency) => dependency.external && !isBuiltin(dependency.path));
  const entries = [
    ...new Set(imports.map((dependency) => fileURLToPath(import.meta.resolve(dependency.path)))),
  ];
  // Trace installed production dependencies on Vercel's build platform, including Sharp's native binaries.
  const { fileList } = await nodeFileTrace(entries, { base: root });
  for (const file of fileList) if (file.startsWith('node_modules/')) await copyIntoFunction(file);
  await writeFile(
    join(functionDir, '.vc-config.json'),
    JSON.stringify({
      runtime: 'nodejs22.x',
      handler: 'server/entry.mjs',
      launcherType: 'Nodejs',
      maxDuration: 120,
      shouldAddHelpers: false,
    }),
  );
}

await rm(functionDir, { recursive: true, force: true });
await rm(staticDir, { recursive: true, force: true });
await mkdir(functionDir, { recursive: true });
await cp(join(root, 'dist'), staticDir, { recursive: true });
await packageServer(await packageCampusData());
// Import the distributed function so the check reads its own graphs and published topology.
const handler = (await import(
  pathToFileURL(join(functionDir, 'server/entry.mjs')).href
)) as typeof import('../server/vercel');
const routing = await handler.checkPublishedRoute();
const graphDigest = await readFile(join(root, 'data/campus/spatial/floor-graphs.sha256'), 'utf8');
if (routing.graphVersion !== graphDigest.trim().slice(0, 16))
  throw Error('Packaged route used a different floor graph from this build.');
console.log('Verified packaged SE12 302 to SW03 1730 route on graph ' + routing.graphVersion + '.');
const manifest = readJson<{ sources: { file: string; url: string }[] }>(
  'data/campus/manifest.json',
);
const redirects = manifest.sources.map((source) => ({
  src: '^/' + source.file.replaceAll('.', '\\.') + '$',
  status: 302,
  headers: { Location: source.url },
}));
await writeFile(
  join(output, 'config.json'),
  JSON.stringify({
    version: 3,
    routes: [
      { src: '^/api(?:/.*)?$', dest: '/api' },
      { src: '^/data/campus/visual/(?:png|atlas)/.+\\.png$', dest: '/api' },
      { src: '^/internal/topology(?:/.*)?$', dest: '/api' },
      ...redirects,
      { handle: 'filesystem' },
    ],
  }),
);
