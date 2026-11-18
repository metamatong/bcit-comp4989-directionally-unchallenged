/** Route-response recovery uses source records and mocked AI, without re-uploading photos. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reviewedNetwork } from '../server/pilot-network';
import type { Provider, ModelPart } from '../server/provider';
import { lookupPilotLabels } from '../server/spatial-retrieval';
import { TopologyStore } from '../server/topology';
import { planAiVisitorJourney } from '../server/wayfinding';
import { photoStartFixture, routeResponse, walkingRouteFixture } from './wayfinding-fixtures';

let directory: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'route-recovery-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function providerFixture(response: ModelPart[] = routeResponse()) {
  return { calls: 0, generate: vi.fn<Provider['generate']>(async () => response) };
}
function navigate(provider: Provider, destination = 'SW03 2082') {
  const candidate = photoStartFixture();
  return planAiVisitorJourney(
    candidate,
    { revision: 1, candidateId: candidate.id, destination },
    store,
    provider,
  );
}

it('resolves SW03 1710 on floor 1 and constrains the AI to its exact source occurrence', async () => {
  const provider = providerFixture([
    {
      functionCall: {
        name: 'generate_walking_route',
        args: {
          outcome: 'no-route',
          explanation: 'No route proposed in this source-lookup fixture.',
        },
      },
    },
  ]);
  const result = await navigate(provider, 'SW03 1710');
  expect(result.destinations).toMatchObject([{ planId: 'SW3-F1-p1', label: '1710' }]);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  const tool = provider.generate.mock.calls[0][1][0] as {
    parameters: { properties: { destinationId: { enum: string[] } } };
  };
  expect(tool.parameters.properties.destinationId.enum).toEqual(
    result.destinations.map((place) => place.id),
  );
});

it('reports the floor mismatch for a 1710 proposal that ends on floor 2 after both attempts', async () => {
  const route = walkingRouteFixture();
  route.destinationId = lookupPilotLabels({
    purpose: 'destination',
    labels: ['SW03 1710'],
  }).results[0].matches[0].occurrences[0].occurrenceId;
  const provider = providerFixture(routeResponse(route));
  expect(await navigate(provider, 'SW03 1710')).toMatchObject({
    status: 'no-route',
    message: expect.stringContaining('floor that did not match'),
    destinations: [{ planId: 'SW3-F1-p1', label: '1710' }],
  });
  expect(provider.generate).toHaveBeenCalledTimes(2);
});

it.each(['destination', 'origin', 'continuity', 'building crossing', 'missing endpoints'])(
  'corrects an invalid %s response within the same deadline',
  async (defect) => {
    const route = walkingRouteFixture();
    if (defect === 'destination') route.destinationId = 'invented-room';
    if (defect === 'origin') route.origin.point = { x: 0.1, y: 0.1 };
    if (defect === 'continuity')
      route.steps[2].from = { ...route.steps[2].from, point: { x: 0.1, y: 0.1 } };
    if (defect === 'building crossing') route.steps[1].connectionId = 'invented-link';
    const first = routeResponse(route);
    if (defect === 'missing endpoints')
      first[0].functionCall!.args = { outcome: 'route', explanation: 'Incomplete proposal.' };
    const provider = providerFixture();
    provider.generate.mockResolvedValueOnce(first);
    expect((await navigate(provider)).status).toBe('route');
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[0][2]).toBe(provider.generate.mock.calls[1][2]);
    const feedback = provider.generate.mock.calls[1][0][0].parts
      .flatMap((part) => part.text ?? [])
      .join(' ');
    expect(feedback).toContain('The proposed route was rejected.');
  },
);

it('corrects an unreadable output without starting another photo analysis', async () => {
  const provider = providerFixture();
  provider.generate.mockResolvedValueOnce([{ text: 'Incomplete provider output.' }]);
  expect((await navigate(provider)).status).toBe('route');
  expect(provider.generate.mock.calls.map((call) => call[4]?.forceTool)).toEqual([
    'generate_walking_route',
    'generate_walking_route',
  ]);
});

it('reports the final failed constraint instead of the generic building-link message', async () => {
  const route = walkingRouteFixture();
  route.steps[2].from = { ...route.steps[2].from, point: { x: 0.1, y: 0.1 } };
  const provider = providerFixture(routeResponse(route));
  const first = walkingRouteFixture();
  first.destinationId = 'invented-room';
  provider.generate.mockResolvedValueOnce(routeResponse(first));
  expect(await navigate(provider)).toMatchObject({
    status: 'no-route',
    message: expect.stringContaining('disconnected walking segments'),
  });
  expect(provider.generate).toHaveBeenCalledTimes(2);
});
