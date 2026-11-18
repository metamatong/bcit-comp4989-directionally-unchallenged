/** AI route validation with mocked provider output and isolated source-bound topology. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reviewedNetwork } from '../server/pilot-network';
import { lookupPilotLabels } from '../server/spatial-retrieval';
import { TopologyStore } from '../server/topology';
import { planAiVisitorJourney } from '../server/wayfinding';
import type { ModelPart, Provider } from '../server/provider';
import type { CandidateAnswer } from '../src/topology';
import { photoStartFixture, routeResponse, walkingRouteFixture } from './wayfinding-fixtures';

let directory: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ai-wayfinding-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function providerFixture(response = routeResponse(), beforeResponse = () => {}) {
  const generate = vi.fn<Provider['generate']>(async (_contents, _tools, _signal, onAttempt) => {
    onAttempt?.();
    beforeResponse();
    return response;
  });
  return { calls: 0, generate };
}

function plan(provider: Provider, destination = 'SW03 2082') {
  const candidate = photoStartFixture();
  return planAiVisitorJourney(
    candidate,
    { revision: 1, candidateId: candidate.id, destination },
    store,
    provider,
  );
}

function reviewCrossing(
  answer: CandidateAnswer['answer'],
  direction: CandidateAnswer['direction'],
) {
  const snapshot = store.snapshot();
  const candidate = snapshot.candidates.find((item) => item.id === 'sw3-se12-floor3-passage')!;
  const position = (side: 'from' | 'to') => {
    const { planId, sourceSha256, point } = candidate[side];
    return { planId, sourceSha256, point };
  };
  store.mutate({
    revision: snapshot.document.revision,
    command: {
      type: 'answer-candidate',
      candidateId: candidate.id,
      presentedHash: candidate.presentedHash,
      from: position('from'),
      to: position('to'),
      answer,
      direction,
      reviewer: 'Regression test',
      note: 'Isolated routing test.',
    },
  });
}

it('generates a floor-by-floor route with source plans and the mapped crossing', async () => {
  const provider = providerFixture();
  const result = await plan(provider);
  expect(result.status).toBe('route');
  if (result.status !== 'route') throw Error('Expected the mocked route');
  expect(result.steps.map((step) => step.kind)).toEqual([
    'corridor',
    'building-link',
    'corridor',
    'elevator',
    'corridor',
  ]);
  expect(result.origin.planId).toBe('SE12-F3-p1');
  expect(result.destination.planId).toBe('SW3-F2-p1');
  for (let index = 1; index < result.steps.length; index++) {
    expect(result.steps[index].from).toEqual(result.steps[index - 1].to);
  }
  const [contents, , , , options] = provider.generate.mock.calls[0];
  expect(options?.forceTool).toBe('generate_walking_route');
  expect(contents[0].parts.filter((part) => part.inlineData)).toHaveLength(8);
  expect(contents[0].parts.flatMap((part) => part.text ?? []).join(' ')).toContain('connectionId');
});

it('allows within-building routes without any approved visitor checkpoints or corridors', async () => {
  const document = store.read();
  writeFileSync(
    store.file,
    JSON.stringify({
      ...document,
      nodes: [],
      edges: [],
      candidateAnswers: [],
      floorObservations: [],
    }),
  );
  const route = walkingRouteFixture();
  route.origin = { ...route.origin, point: { x: 0.12, y: 0.59 } };
  const occurrence = lookupPilotLabels({
    purpose: 'destination',
    labels: ['SE12 302'],
  }).results[0].matches[0].occurrences[0];
  route.destination = {
    planId: 'SE12-F3-p1',
    label: '302',
    point: { x: 0.1508, y: 0.5821 },
  };
  route.destinationId = occurrence.occurrenceId;
  route.steps = [
    {
      kind: 'corridor',
      from: route.origin,
      to: route.destination,
      path: [route.origin.point, { x: 0.1508, y: 0.5931818 }, route.destination.point],
      instruction: 'Follow the source corridor frontage to room 302.',
    },
  ];
  const candidate = photoStartFixture(route.origin);
  expect(
    (
      await planAiVisitorJourney(
        candidate,
        { revision: 1, candidateId: candidate.id, destination: 'SE12 302' },
        store,
        providerFixture(routeResponse(route)),
      )
    ).status,
  ).toBe('route');
});

it('returns unknown-destination without spending a provider call', async () => {
  const provider = providerFixture();
  expect((await plan(provider, 'SW03 99999')).status).toBe('unknown-destination');
  expect(provider.generate).not.toHaveBeenCalled();
});

it('rejects a path through an adjacent room even when all endpoints and building links match', async () => {
  const route = walkingRouteFixture();
  route.steps[2].path = [route.steps[2].from.point, { x: 0.7, y: 0.58 }, route.steps[2].to.point];
  const provider = providerFixture(routeResponse(route));
  const result = await plan(provider);
  expect(result).toMatchObject({
    status: 'no-route',
    message: expect.stringContaining('crosses source drawing lines'),
  });
  expect(provider.generate).toHaveBeenCalledTimes(2);
});

it('regenerates a shortcut once with drawing feedback and returns the corridor-following path', async () => {
  const badRoute = walkingRouteFixture();
  badRoute.steps[2].path = [
    badRoute.steps[2].from.point,
    { x: 0.7, y: 0.58 },
    badRoute.steps[2].to.point,
  ];
  const provider = providerFixture();
  provider.generate.mockResolvedValueOnce(routeResponse(badRoute));
  const result = await plan(provider);
  expect(result.status).toBe('route');
  expect(provider.generate).toHaveBeenCalledTimes(2);
  if (result.status !== 'route') throw new Error('Missing corrected route');
  expect(result.steps[2].path.length).toBeGreaterThan(2);
  const feedback = provider.generate.mock.calls[1][0][0].parts
    .flatMap((part) => part.text ?? [])
    .join(' ');
  expect(feedback).toContain('crossed source drawing strokes');
});

it.each([
  'unmapped crossing',
  'disconnected steps',
  'wrong origin',
  'wrong destination',
  'invalid coordinates',
])('rejects a route with %s', async (defect) => {
  const route = walkingRouteFixture();
  if (defect === 'unmapped crossing') route.steps[1].connectionId = 'invented-link';
  if (defect === 'disconnected steps')
    route.steps[2].from = { ...route.steps[2].from, point: { x: 0.1, y: 0.1 } };
  if (defect === 'wrong origin') route.origin.point = { x: 0.1, y: 0.1 };
  if (defect === 'wrong destination') route.destinationId = 'invented-room';
  if (defect === 'invalid coordinates') route.steps[0].path[0] = { x: 2, y: 0 };
  expect((await plan(providerFixture(routeResponse(route)))).status).toBe('no-route');
});

it.each([
  ['false', null],
  ['unknown', null],
  ['true', 'unknown'],
  ['true', 'a-to-b'],
] as const)('rejects a crossing with review %s and direction %s', async (answer, direction) => {
  reviewCrossing(answer, direction);
  expect((await plan(providerFixture())).status).toBe('no-route');
});

it('rejects an approval withdrawn while the AI request is in flight', async () => {
  const provider = providerFixture(routeResponse(), () => reviewCrossing('false', null));
  await expect(plan(provider)).rejects.toMatchObject({ httpStatus: 409 });
});

it.each<{ response: ModelPart[] }>([
  { response: [{ text: 'A route without the requested tool call.' }] },
  {
    response: [
      {
        functionCall: {
          name: 'generate_walking_route',
          args: {
            outcome: 'no-route',
            explanation: 'The floor plans do not establish a continuous route.',
          },
        },
      },
    ],
  },
])('abstains when the provider cannot return a supported route', async ({ response }) => {
  expect((await plan(providerFixture(response))).status).toBe('no-route');
});
