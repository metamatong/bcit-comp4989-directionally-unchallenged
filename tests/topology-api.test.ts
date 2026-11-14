import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { createApp } from '../server/app';
import { TopologyStore } from '../server/topology';
import type { TopologyBootstrap } from '../src/topology';

let directory: string, server: Server, base: string, data: TopologyBootstrap;
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
    throw new Error('The editor must never invoke Gemini.');
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
it('loads the empty scoped editor without a Gemini key and keeps it out of visitor bootstrap', async () => {
  const response = await fetch(`${base}/api/internal/topology`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  data = await response.json();
  expect(data.plans).toHaveLength(12);
  expect(data.document.nodes).toEqual([]);
  expect(data.candidates.some((candidate) => candidate.kind === 'stairs')).toBe(true);
  expect(data.candidates.some((candidate) => candidate.kind === 'elevator')).toBe(true);
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  expect(bootstrap).not.toHaveProperty('topology');
  expect(provider.calls).toBe(0);
});
it('persists a point through the API, rejects stale edits and cannot inject approved state', async () => {
  const command = pointCommand;
  const response = await post('/edits', { revision: 0, command });
  expect(response.status).toBe(200);
  data = await response.json();
  expect(data.document.nodes[0].review).toBeNull();
  expect(data.document.nodes[0].label).toBe(command.label);
  expect((await post('/edits', { revision: 0, command })).status).toBe(409);
  expect(
    (await post('/edits', { revision: 1, command: { ...command, review: { status: 'verified' } } }))
      .status,
  ).toBe(400);
  expect((await (await fetch(`${base}/api/internal/topology`)).json()).document.nodes).toHaveLength(
    1,
  );
});
it('applies endpoint review gating to HTTP route calculations and rejects unsupported requests', async () => {
  data = await (await post('/edits', { revision: 0, command: pointCommand })).json();
  const id = data.document.nodes[0].id;
  const route = {
    revision: data.document.revision,
    fromNodeId: id,
    toNodeId: id,
    mode: 'fewest-connections',
  };
  expect((await (await post('/route', route)).json()).outcome).toBe('no-route');
  data = await (
    await post('/edits', {
      revision: data.document.revision,
      command: {
        type: 'review',
        target: 'node',
        id,
        status: 'verified',
        reviewer: 'API test',
        note: 'This tests approval, not physical accuracy.',
      },
    })
  ).json();
  expect(
    (await (await post('/route', { ...route, revision: data.document.revision })).json()).outcome,
  ).toBe('route');
  expect((await post('/route', route)).status).toBe(409);
  expect((await post('/route', { ...route, mode: 'invent-distance' })).status).toBe(400);
});
it('rejects cross-site and rebinding access, including access to the internal page', async () => {
  expect((await post('/edits', {}, { Origin: 'https://example.com' })).status).toBe(403);
  // fetch replaces Host; raw HTTP sends the rebinding header that this test needs.
  const statusWithHost = (path: string) =>
    new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${base}${path}`,
        { headers: { Host: 'attacker.example' } },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      request.on('error', reject);
      request.end();
    });
  expect(await statusWithHost('/api/internal/topology')).toBe(403);
  expect(await statusWithHost('/internal/topology')).toBe(403);
  expect(
    (await fetch(`${base}/api/internal/topology`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))
      .status,
  ).toBe(403);
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
it('records a candidate answer through the guarded API without invoking Gemini', async () => {
  const initial: TopologyBootstrap = await (await fetch(`${base}/api/internal/topology`)).json();
  const candidate = initial.candidates[0];
  const position = (side: 'from' | 'to') => {
    const { planId, sourceSha256, point } = candidate[side];
    return { planId, sourceSha256, point };
  };
  const command = {
    type: 'answer-candidate',
    candidateId: candidate.id,
    presentedHash: candidate.presentedHash,
    from: position('from'),
    to: position('to'),
    answer: 'true',
    direction: 'a-to-b',
    reviewer: 'Mock API reviewer',
    note: 'No physical verification.',
  };
  const response = await post('/edits', { revision: initial.document.revision, command });
  expect(response.status).toBe(200);
  const saved: TopologyBootstrap = await response.json();
  expect(saved.eligibility.edgeIds).toHaveLength(1);
  expect(saved.document.candidateAnswers).toHaveLength(1);
  expect(saved.document.edges[0].evidence.basis).toBe('user-confirmation');
  expect((await post('/edits', { revision: initial.document.revision, command })).status).toBe(409);
  expect(provider.calls).toBe(0);
});
it('saves a floor-only elevator observation separately from point approvals', async () => {
  const initial: TopologyBootstrap = await (await fetch(`${base}/api/internal/topology`)).json();
  const inquiry = initial.candidates.find((item) => item.allowsFloorOnlyAnswer)!;
  const position = (side: 'from' | 'to') => {
    const { planId, sourceSha256, point } = inquiry[side];
    return { planId, sourceSha256, point };
  };
  const fields = {
    candidateId: inquiry.id,
    presentedHash: inquiry.presentedHash,
    reviewer: 'Test',
    note: '',
    from: position('from'),
    to: position('to'),
  };
  const revision = initial.document.revision;
  expect(
    (
      await post('/edits', {
        revision,
        command: { ...fields, type: 'answer-candidate', answer: 'true', direction: 'both' },
      })
    ).status,
  ).toBe(400);
  const saved = await post('/edits', {
    revision,
    command: { ...fields, type: 'record-floor-observation', answer: 'unknown' },
  });
  expect(saved.status).toBe(200);
  const snapshot: TopologyBootstrap = await saved.json();
  expect(snapshot.document.floorObservations[0]).toMatchObject({
    definitionHash: inquiry.definitionHash,
    presentedHash: inquiry.presentedHash,
    from: { point: null },
    to: { point: null },
  });
  expect(snapshot.document.candidateAnswers).toEqual([]);
  expect(snapshot.eligibility.edgeIds).toEqual([]);
});
