import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readJson, root } from '../server/data';
import { planAtlases, visualPlans } from '../server/visual-data';
it('preserves the hash and provenance of every downloaded official PDF', () => {
  const manifest = readJson<{
    sources: {
      id: string;
      sha256: string;
      file: string;
      campus: string;
      url: string;
      retrievedAt: string;
      attribution: string;
    }[];
  }>('data/campus/manifest.json');
  expect(manifest.sources).toHaveLength(90);
  for (const source of manifest.sources) {
    expect(source.campus).toBe('Burnaby');
    expect(source.url).toMatch(/^https:\/\/www\.bcit\.ca\//);
    expect(
      createHash('sha256')
        .update(readFileSync(`${root}/${source.file}`))
        .digest('hex'),
    ).toBe(source.sha256);
    expect(source.retrievedAt).toBeTruthy();
    expect(source.attribution).toContain('British Columbia Institute of Technology');
  }
});
it('keeps synthetic topology out of campus records', () => {
  expect(readJson<{ nodes: unknown[]; edges: unknown[] }>('data/campus/graph.json')).toMatchObject({
    nodes: [],
    edges: [],
  });
  expect(readJson<{ landmarks: unknown[] }>('data/campus/landmarks.json')).toMatchObject({
    landmarks: [],
  });
});

it('preserves the exact indexed bytes of every floor-plan asset on checkout', () => {
  const assets = visualPlans
    .flatMap((plan) => [plan.full, plan.overview, ...plan.tiles, plan.geometry])
    .concat(planAtlases);
  expect(assets).toHaveLength(631);
  for (const asset of assets) {
    const bytes = readFileSync(`${root}/${asset.file}`);
    expect(createHash('sha256').update(bytes).digest('hex'), asset.file).toBe(asset.sha256);
  }
});
