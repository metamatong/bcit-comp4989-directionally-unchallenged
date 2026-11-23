/** Replay source signs across the approved west-wing doors and stairs, including withdrawal. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { candidateFromSignMatch } from '../server/label-localization';
import { reviewedNetwork } from '../server/pilot-network';
import { resolveStartingSigns } from '../server/starting-place-evidence';
import { TopologyStore } from '../server/topology';
import { planVisitorNavigation } from '../server/wayfinding';

let directory: string;
let store: TopologyStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sw03-west-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

async function navigate(plan: string, sign: string, destination: string, allowDoorChoice = false) {
  const readings = resolveStartingSigns([
    { text: sign, kind: 'room', placement: 'door', clarity: 'clear', viewId: 'full' },
  ]);
  const match = readings.matches.find((m) => m.place.planId === plan)!;
  const candidate = candidateFromSignMatch(match, readings.references);
  const request = { revision: 0, candidateId: candidate.id, destination };
  const result = await planVisitorNavigation(candidate, request, store);
  return result;
}

it.each([
  ['SE12-F3-p1', '323', 'SW03 1920', '1700', '1900'],
  ['SW3-F1-p1', '1920', 'SE12 302', '1900', '1700'],
])(
  'walks between %s %s and %s using the confirmed outdoor entrances',
  async (plan, sign, goal, from, to) => {
    const result = await navigate(plan, sign, goal, sign === '1920');
    if (result.status !== 'route') throw Error(result.status);
    const crossing = result.steps.find((s) => s.kind === 'outdoor')!;
    expect([crossing.from.planId, crossing.to.planId]).toEqual(['SW3-F1-p1', 'SW3-F1-p1']);
    expect(crossing.from.label).toContain(from);
    expect(crossing.to.label).toContain(to);
    expect(crossing.path).toEqual([]);
    expect(result.destination.label).toContain(goal.split(' ')[1]);
    expect(result.steps.at(-1)?.path.at(-1)).toEqual(result.destination.point);
  },
);

it.each([
  ['SW3-F1-p1', 'S190', 'S299'],
  ['SW3-F2-p1', 'S299', 'S190'],
])('preserves the marked direction from %s %s to %s', async (plan, from, to) => {
  const result = await navigate(plan, from, 'SW03 ' + to);
  if (result.status !== 'route') throw Error(result.status);
  expect(result.steps).toHaveLength(1);
  expect(result.steps[0]).toMatchObject({
    kind: 'stairs',
    from: { label: expect.stringContaining(from) },
    to: { label: expect.stringContaining(to) },
    path: [],
  });
});

it('removes access from the main passage to 1920 when the outdoor crossing is withdrawn', async () => {
  const snapshot = store.snapshot();
  const crossing = snapshot.candidates.find((c) => c.id === 'sw3-f1-1700-to-1900-west-exterior')!;
  const binding = crossing.latestAnswer!.bindings!;
  store.mutate({
    revision: snapshot.document.revision,
    command: {
      type: 'review',
      target: 'edge',
      id: binding.edgeId,
      status: 'rejected',
      reviewer: 'Isolated test',
      note: 'Withdraw the outdoor permission in this copy.',
    },
  });
  const result = await navigate('SE12-F3-p1', '323', 'SW03 1920', true);
  expect(result.status).not.toBe('route');
  expect(result.mappedPortion?.destination.id).not.toBe(binding.toNodeId);
});

it.each([
  ['SW3-F2-p1', '2690', 'SE12 100E'],
  ['SE12-F1-p1', '100E', 'SW03 2690'],
])('connects %s %s and %s through the signed vestibule', async (plan, sign, destination) => {
  const result = await navigate(plan, sign, destination);
  if (result.status !== 'route') throw Error(result.status);
  expect(result.destination.label).toBe(destination.split(' ')[1]);
  expect(result.steps.at(-1)?.path.at(-1)).toEqual(result.destination.point);
});
