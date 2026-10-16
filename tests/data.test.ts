import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readJson, root } from '../server/data';
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
it('keeps campus routing source-linked and separates unreviewed landmark candidates', () => {
  const graph = readJson<{
    sourceRef: string;
    nodes: { id: string }[];
    edges: { from: string; to: string; sourceRef: string; accessibility: string }[];
    limitations: string[];
  }>('data/campus/graph.json');
  expect(graph.sourceRef).toBe('burnaby-wayfinding#page=1');
  expect(graph.nodes.length).toBeGreaterThan(1);
  expect(graph.edges.length).toBeGreaterThan(1);
  expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.from))).toBe(true);
  expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.to))).toBe(true);
  expect(graph.edges.every((edge) => edge.sourceRef === graph.sourceRef)).toBe(true);
  expect(graph.edges.every((edge) => edge.accessibility === 'unknown')).toBe(true);
  expect(graph.limitations.join(' ')).toContain('not been field-verified');
  expect(readJson<{ landmarks: unknown[] }>('data/campus/landmarks.json')).toMatchObject({
    landmarks: [],
  });
});
