import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { TopologyStore } from '../server/topology';

let directory: string, server: Server, base: string;
const pointCommand = {
  type: 'save-node',
  planId: 'SE12-F3-p1',
  label: '0302A fixture',
  kind: 'door',
  point: { x: 0.2, y: 0.3 },
  notes: '',
  evidence: {
    basis: 'plan',
    note: 'Mocked API evidence, not a real campus annotation.',
    observedOn: null,
  },
};
const provider = {
  calls: 0,
  generate: async () => {
    provider.calls++;
    throw new Error('Removed editor endpoints must never invoke Gemini.');
  },
};
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'campuslens-topology-api-'));
  const file = join(directory, 'topology.json');
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, revision: 0, updatedAt: null, nodes: [], edges: [] }),
  );
  const app = createApp({
    provider,
    liveAvailable: false,
    model: 'unconfigured',
    topologyStore: new TopologyStore(file),
  });
  // Simulate the later Vite/static fallback to prove private storage cannot fall through to it.
  app.use((_req, res) => res.status(200).send('Static fallback fixture'));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => {
  writeFileSync(
    join(directory, 'topology.json'),
    JSON.stringify({ schemaVersion: 1, revision: 0, updatedAt: null, nodes: [], edges: [] }),
  );
});
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/internal/topology${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
it('does not expose the removed topology API or allow its commands to mutate storage', async () => {
  const before = readFileSync(join(directory, 'topology.json'), 'utf8');
  expect((await fetch(`${base}/api/internal/topology`)).status).toBe(404);
  for (const endpoint of ['/edits', '/route', '/candidates/answer']) {
    expect((await post(endpoint, { revision: 0, command: pointCommand })).status).toBe(404);
  }
  expect(readFileSync(join(directory, 'topology.json'), 'utf8')).toBe(before);
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  expect(bootstrap).not.toHaveProperty('topology');
  expect(provider.calls).toBe(0);
});
it('retains same-origin protection on removed API paths', async () => {
  expect((await post('/edits', {}, { Origin: 'https://example.com' })).status).toBe(403);
});
it('blocks raw annotation, lock and temporary files before the development/static file fallback', async () => {
  expect((await fetch(`${base}/ordinary-static-file.txt`)).status).toBe(200);
  for (const path of [
    '/data/campus/topology.json',
    '/data/campus/connection-candidates.json',
    '/data/campus/topology.json.lock',
    '/data/campus/topology.json.test.tmp',
    '/data/campus/%74opology.json?import',
    `/@fs${join(directory, 'topology.json')}`,
  ]) {
    const response = await fetch(`${base}${path}`);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Topology storage is not a public asset.');
  }
});
