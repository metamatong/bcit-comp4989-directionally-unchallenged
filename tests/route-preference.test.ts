/** Real source grids and approved transfers; isolated snapshots, no campus or provider check. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { visitorPassages } from '../server/visitor-paths';
import { FloorSearch } from '../server/floor-search';
import { navigationSchema, planVisitorJourney } from '../server/wayfinding';
import { photoStartFixture } from './wayfinding-fixtures';

let directory: string, store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'route-preference-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function search(excluded?: 'stairs' | 'elevator' | 'both') {
  const { document, eligibility } = store.snapshot();
  const network = visitorPassages(document, eligibility, store.candidates, store.plans);
  for (const edge of document.edges)
    if (
      edge.kind === excluded ||
      (excluded === 'both' && (edge.kind === 'stairs' || edge.kind === 'elevator'))
    )
      network.allowed.delete(edge.id);
  const planner = new FloorSearch({
    plans: store.plans,
    doc: document,
    nodes: document.nodes,
    network,
  });
  const landing = (floor: string) =>
    planner.reviewed(
      document.nodes.find(
        (n) =>
          n.planId === `SW3-F${floor}-p1` &&
          n.kind === (excluded === 'elevator' ? 'stair-landing' : 'elevator-stop'),
      )!.id,
    )!;
  return { planner, from: landing('3'), to: landing('4') };
}

it.each([false, true])(
  'prefers the requested transfer on the compiled floor grids: elevators=%s',
  (preferElevators) => {
    const { planner, from, to } = search();
    const route = planner.route([from], [to], preferElevators)!;
    expect(route).toBeDefined();
    expect(route.steps.some((s) => s.kind === (preferElevators ? 'elevator' : 'stairs'))).toBe(
      true,
    );
    expect(route.steps.some((s) => s.kind === (preferElevators ? 'stairs' : 'elevator'))).toBe(
      false,
    );
    expect(planner.route([from], [from], preferElevators)?.steps).toEqual([]);
  },
);

it('uses elevators only when selected, even when stairs are available', () => {
  const { planner, from, to } = search('elevator');
  expect(planner.route([from], [to], true)).toBeUndefined();
});

it('falls back to elevators when stairs are preferred but unavailable', () => {
  const { planner, from, to } = search('stairs');
  const route = planner.route([from], [to], false)!;
  expect(route).toBeDefined();
  expect(route.steps.some((s) => s.kind === 'stairs')).toBe(false);
  expect(route.steps.some((s) => s.kind === 'elevator')).toBe(true);
});

it('validates the preference and preserves a legacy route when only an elevator path is approved', () => {
  const candidate = photoStartFixture();
  const query = { revision: 1, candidateId: candidate.id, destination: 'SW03 2082' };
  expect(navigationSchema.safeParse({ ...query, preferElevators: 'true' }).success).toBe(false);
  for (const preferElevators of [false, true]) {
    expect(navigationSchema.safeParse({ ...query, preferElevators }).success).toBe(true);
    const route = planVisitorJourney(candidate, { ...query, preferElevators }, store);
    expect(route.status).toBe('route');
    if (route.status === 'route') expect(route.steps.some((s) => s.kind === 'elevator')).toBe(true);
  }
});

it('reports no path when both transfer types are unavailable', () => {
  const { planner, from, to } = search('both');
  expect(planner.route([from], [to], false)).toBeUndefined();
  expect(planner.route([from], [to], true)).toBeUndefined();
});
