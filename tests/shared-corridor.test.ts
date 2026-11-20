import { gpsHint } from './photo-fixtures';
/** Replay the locker-hall sign roles against the distributable map, including negative controls. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { floorGraphs } from '../server/floor-graph';
import { locateFromLabels } from '../server/label-localization';
import { newSession } from '../server/session';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { planVisitorNavigation } from '../server/wayfinding';
import type { PhotoFeatures, PhotoLabelReading, PhotoEvidence } from '../src/types';

const dir = mkdtempSync(join(tmpdir(), 'signed-corridor-'));
const store = new TopologyStore(join(dir, 'topology.json'), undefined, undefined, reviewedNetwork);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const straight: PhotoFeatures = {
  visibleDoorCount: 2,
  windowsSide: 'not-visible',
  corridorShape: 'straight',
};
const sign = (
  text: string,
  placement: PhotoLabelReading['placement'] = 'directional-sign',
  directionCue?: PhotoLabelReading['directionCue'],
): PhotoLabelReading => ({
  text,
  clarity: 'clear',
  kind: 'room',
  placement,
  viewId: 'full',
  directionCue,
});

function locate(
  labels: PhotoLabelReading[],
  features: PhotoFeatures | null = straight,
  buildingHint?: string,
) {
  const session = newSession(true, 'gemini');
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels,
    observations: ['Lockers on both sides of a hallway.'],
    ...(features ? { features } : {}),
    readAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    usedFallbackModel: true,
  };
  session.photoEvidence = evidence;
  const analysis = locateFromLabels(
    session,
    {
      requestId: randomUUID(),
      revision: session.revision,
      evidenceId: evidence.id,
      gps: gpsHint(buildingHint?.replace(/^SW0/, 'SW') ?? 'SW3'),
    },
    { sessionId: session.id, evidence, fingerprint: 'sign-reading-replay', buildingHint },
  );
  return { session, analysis };
}

it('automatically uses the source-backed corridor from the two sign classifications and routes its public reference to SE12 302', async () => {
  const { session, analysis } = locate([sign('2695'), sign('2680')]);
  expect(session.campusLocation?.id).toBe(analysis.candidates[0].id);
  expect(analysis.candidates).toHaveLength(1);
  const [candidate] = analysis.candidates;
  expect(candidate).toMatchObject({
    planId: 'SW3-F2-p1',
    corridorOrigin: { roomLabels: ['2680', '2695'], needsConfirmation: true },
  });
  expect(analysis.referenceLabels?.map((r) => r.label).sort()).toEqual(['2680', '2695']);
  const route = await planVisitorNavigation(
    session.campusLocation!,
    { candidateId: candidate.id, revision: 0, destination: 'SE12 302', preferElevators: true },
    store,
  );
  if (route.status !== 'route') throw Error(route.status + ' ' + route.message);
  expect(route.steps.map((s) => s.kind)).toEqual([
    'corridor',
    'elevator',
    'corridor',
    'building-link',
    'corridor',
  ]);
  expect(route.steps[1].to.planId).toBe('SW3-F3-p1');
  expect(route.steps[3].to.planId).toBe('SE12-F3-p1');
  expect(route.destination.label).toBe('302 · window-side corridor door');
  expect(route.origin).toMatchObject({
    planId: 'SW3-F2-p1',
    label: 'Corridor 2600 between 2680 and 2695',
    startRegion: candidate.bounds,
  });
  const p = route.origin.point;
  expect(floorGraphs().byId.get(route.origin.planId)!.containingCell(p)).toBeDefined();
  for (const ref of candidate.sourceLabels!) {
    const [l, t, r, b] = ref.bounds;
    expect(p.x >= l && p.x <= r && p.y >= t && p.y <= b).toBe(false);
  }
  expect(session.providerCalls).toBe(0);
});

it('automatically uses explicit local room plaques and preserves sign order and duplicate invariance', () => {
  for (const labels of [
    [sign('2680', 'door', 'none'), sign('2695', 'door', 'none')],
    [sign('2695', 'door', 'none'), sign('2695', 'door', 'none'), sign('2680', 'door', 'none')],
  ]) {
    const { session } = locate(labels);
    expect(session.campusLocation?.corridorOrigin).toMatchObject({
      needsConfirmation: false,
      roomLabels: ['2680', '2695'],
    });
  }
});

it('automatically selects the supported shared stretch while retaining placement uncertainty', () => {
  const { session, analysis } = locate([sign('2695', 'door', 'none'), sign('2680', 'other')]);
  expect(analysis.candidates).toHaveLength(1);
  expect(analysis.candidates[0].corridorOrigin?.needsConfirmation).toBe(true);
  expect(session.campusLocation?.id).toBe(analysis.candidates[0].id);
});

it('requires source identity and current room bindings for an automatic corridor start', async () => {
  const [candidate] = locate([sign('2680'), sign('2695')]).analysis.candidates;
  for (const invalid of [
    { ...candidate, sourcePlaceId: 'stale' },
    { ...candidate, sourceLabels: candidate.sourceLabels?.slice(1) },
    {
      ...candidate,
      sourceLabels: candidate.sourceLabels?.map((r) => ({ ...r, sourceSha256: '0'.repeat(64) })),
    },
    { ...candidate, corridorOrigin: { ...candidate.corridorOrigin!, bandId: 'another-band' } },
  ])
    expect(
      (
        await planVisitorNavigation(
          invalid,
          { revision: 0, candidateId: invalid.id, destination: 'SE12 302' },
          store,
        )
      ).origins,
    ).toEqual([]);
});

it('requires distinct opposing local frontages, consistent context and no explicit travel cue', () => {
  for (const labels of [
    [sign('2695'), sign('2695')],
    [sign('2695'), sign('2675')],
    [sign('2605'), sign('2680')],
    [sign('2695'), sign('2680', 'directional-sign', 'arrow')],
    [sign('2695', 'directional-sign', 'directional-words'), sign('2680')],
    [sign('2695', 'door', 'arrow'), sign('2680', 'door', 'arrow')],
    [sign('2695'), { ...sign('2680'), clarity: 'uncertain' as const }],
    [sign('02695'), sign('2680')],
    [sign('2695'), sign('2680'), sign('323', 'door')],
  ]) {
    const { session, analysis } = locate(labels);
    expect(
      analysis.candidates.some((c) => c.corridorOrigin),
      JSON.stringify(labels),
    ).toBe(false);
    expect(session.campusLocation?.corridorOrigin).toBeUndefined();
  }
  for (const f of [
    null,
    { ...straight, visibleDoorCount: 0 },
    { ...straight, corridorShape: 'turn' as const },
  ]) {
    expect(locate([sign('2695'), sign('2680')], f).analysis.candidates).toEqual([]);
  }
  expect(locate([sign('2695'), sign('2680')], straight, 'SW05').analysis.candidates).toEqual([]);
});

it('preserves individual source entrances and derives another pair from an independently named strip', async () => {
  for (const label of ['2695', '2680']) {
    const { session } = locate([sign(label, 'door', 'none')], straight, 'SW03');
    expect(session.campusLocation?.anchorLabel).toBe(label);
    expect(
      (
        await planVisitorNavigation(
          session.campusLocation!,
          { revision: 0, candidateId: session.campusLocation!.id, destination: 'SE12 302' },
          store,
        )
      ).origins,
    ).toHaveLength(2);
  }
  expect(
    locate([sign('4710', 'door'), sign('4725', 'door')], straight, 'SW03').session.campusLocation,
  ).toMatchObject({
    planId: 'SW3-F4-p1',
    anchorLabel: 'Corridor 4700 between 4710 and 4725',
  });
});
