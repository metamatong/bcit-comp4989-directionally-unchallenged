import { gpsHint } from './photo-fixtures';
// @vitest-environment jsdom
/** Recognized signs without route coverage must not be presented as poor-photo failures. */
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newSession } from '../server/session';
import { locateFromLabels } from '../server/label-localization';
import { TopologyStore } from '../server/topology';
import { reviewedNetwork } from '../server/pilot-network';
import { planVisitorNavigation } from '../server/wayfinding';
import { checkPublishedRoute } from '../server/routing-readiness';
import { CampusLocationResults } from '../src/components/CampusLocationResults';
import { JourneyPanel, StartingPositionNotice } from '../src/components/JourneyPanel';
import { RouteDirections } from '../src/components/RouteDirections';
import type { CampusLocationCandidate, PhotoEvidence } from '../src/types';
import type { NavigationResult } from '../src/wayfinding';

let directory: string, store: TopologyStore, host: HTMLDivElement, root: Root;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'origin-coverage-'));
  store = new TopologyStore(
    join(directory, 'topology.json'),
    undefined,
    undefined,
    reviewedNetwork,
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

function matchedPlace(label: string, usedFallbackModel = false) {
  const session = newSession(true, 'gemini');
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels: [{ text: label, clarity: 'clear', viewId: 'full', kind: 'room', placement: 'door' }],
    observations: ['A clear room sign is attached to the visible doorway.'],
    features: { visibleDoorCount: 1, windowsSide: 'right', corridorShape: 'straight' },
    readAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    usedFallbackModel,
  };
  session.photoEvidence = evidence;
  const analysis = locateFromLabels(
    session,
    {
      requestId: randomUUID(),
      revision: 0,
      evidenceId: evidence.id,
      gps: gpsHint(label === '2605' ? 'SW3' : 'SE12'),
    },
    {
      sessionId: session.id,
      fingerprint: 'structured-evidence-fixture',
      buildingHint: label === '2605' ? 'SW3' : 'SE12',
      evidence,
    },
  );
  if (!session.campusLocation) throw Error('Expected a source-label match');
  expect(session.providerCalls).toBe(0);
  return { candidate: session.campusLocation, analysis };
}

function navigate(candidate: CampusLocationCandidate, destination = 'SW03 1710') {
  return planVisitorNavigation(
    candidate,
    { revision: 1, candidateId: candidate.id, destination },
    store,
  );
}
async function show(
  candidate: CampusLocationCandidate,
  result: NavigationResult,
  destination = 'SW03 1710',
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(result)),
  );
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(StartingPositionNotice, {
          labelOnly: !!candidate.anchorLabel && !candidate.doorwayVicinity,
        }),
        createElement(JourneyPanel, {
          sessionId: randomUUID(),
          revision: 1,
          candidate,
          destination,
          locationEvidence: 'Matched photo sign',
          plans: store.plans,
          busy: false,
          onTryAnotherPhoto: vi.fn(),
        }),
      ),
    ),
  );
}

it('draws directions from SE12 302 to the SW03 1730 entrance without asking for a map point', async () => {
  const { candidate } = matchedPlace('302');
  const destination = 'SW03 1730';
  const route = await navigate(candidate, destination);
  expect(route.status).toBe('route');
  await show(candidate, route, destination);
  const directions = host.querySelector('[aria-label="Your walking route"]')!;
  expect(directions.querySelector('.route-overview')?.textContent).toContain('1730');
  const arrival = [...directions.querySelectorAll('.route-map-stack figure')].at(-1)!;
  expect(arrival.querySelector('.route-floor-label')?.textContent).toBe('SW03 · Floor 1');
  expect(arrival.querySelector('.pin-legend')?.textContent).toContain('Destination · 1730');
  expect(arrival.querySelector('[data-walking-line=true]')).toBeTruthy();
  expect(directions.querySelector('.floor-point-picker')).toBeNull();
  expect(
    host.querySelector('.journey-evidence:not([open]) .floor-point-picker summary')?.textContent,
  ).toBeUndefined();
  expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
});

it('uses an elevator without stairs from SE12 302 to the SW03 1730 entrance', async () => {
  const { candidate } = matchedPlace('302');
  const result = await planVisitorNavigation(
    candidate,
    {
      revision: 1,
      candidateId: candidate.id,
      destination: 'SW03 1730',
      preferElevators: true,
    },
    store,
  );
  if (result.status !== 'route') throw Error(JSON.stringify(result));
  expect(result.steps.some((step) => step.kind === 'elevator')).toBe(true);
  expect(result.steps.some((step) => step.kind === 'stairs')).toBe(false);
});

it('draws the final corridor to room 402 after returning from the SW03 elevator', async () => {
  const { candidate } = matchedPlace('302');
  const result = await planVisitorNavigation(
    candidate,
    { revision: 1, candidateId: candidate.id, destination: 'SE12 402', preferElevators: true },
    store,
  );
  if (result.status !== 'route')
    throw Error('Expected a complete elevator route: ' + result.status);
  expect(
    result.steps.some((step) => step.kind === 'elevator' && step.to.planId === 'SW3-F4-p1'),
  ).toBe(true);
  expect(result.steps.some((step) => step.kind === 'stairs')).toBe(false);
  const crossing = result.steps.at(-2)!;
  const arrival = result.steps.at(-1)!;
  expect(crossing).toMatchObject({
    kind: 'building-link',
    from: { planId: 'SW3-F4-p1' },
    to: { planId: 'SE12-F4-p1', label: 'Passage to SW03' },
  });
  expect(arrival).toMatchObject({
    kind: 'corridor',
    from: crossing.to,
    to: { planId: 'SE12-F4-p1', label: '402' },
  });
  expect(arrival.path[0]).toEqual(crossing.to.point);
  expect(arrival.path.length).toBeGreaterThan(2);
  expect(arrival.path.at(-1)).toEqual(result.destination.point);

  await act(async () =>
    root.render(
      createElement(RouteDirections, {
        route: result,
        plans: store.plans,
        onRecheck: vi.fn(),
        preferElevators: true,
        gpsTestMode: true,
      }),
    ),
  );
  const overview = host.querySelector<HTMLButtonElement>('button[aria-label="Route overview"]')!;
  await act(async () => overview.click());
  const finalMap = host.querySelector('figure[aria-label="SE12 · Floor 4"]')!;
  expect(finalMap.querySelector('.pin-legend')?.textContent).toContain('Destination · 402');
  const line = finalMap.querySelector('[data-walking-line="true"]');
  expect(line).toBeTruthy();
  expect(line?.parentElement?.querySelector('path')).toBeTruthy();
});

it('keeps the matched room on a coverage-error card without making a real room a permanent failure fixture', async () => {
  const { candidate } = matchedPlace('302');
  const destination = 'SW03 1730';
  const result: NavigationResult = {
    status: 'unmapped-destination',
    networkRevision: 1,
    origins: [],
    destinations: [],
    message:
      'The floor plan shows SW03 · Floor 1 · 1730. Its entrance has no mapped connection to a public corridor.',
  };
  await show(candidate, result, destination);
  const panel = host.querySelector('[aria-label="Route to destination"]')!;
  expect(panel.textContent).toContain('SW03 · Floor 1 · 1730');
  expect(panel.querySelector('.floor-point-picker, select')).toBeNull();
  expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'routes either 323 door along the same corridor to the actual 1750 entrance with fallback=%s',
  async (fallback) => {
    const { candidate } = matchedPlace('323', fallback);
    const destination = 'SW03 1750';
    const result = await navigate(candidate, destination);
    if (result.status !== 'route') throw Error(result.message);
    expect(result.origins).toHaveLength(2);
    expect(result.origin.startRegion).toBeDefined();
    expect(result.destination).toMatchObject({ label: '1750', planId: 'SW3-F1-p1' });
    expect(result.steps.at(-1)?.path.at(-1)).toEqual(result.destination.point);
    await show(candidate, result, destination);
    expect(
      host.querySelector('.route-map-stack figure:last-of-type .pin-legend')?.textContent,
    ).toContain('Destination · 1750');
    expect(
      host.querySelector('.route-map-stack figure:last-of-type [data-walking-line]'),
    ).toBeTruthy();
    expect(host.textContent).not.toContain('Which doorway are you beside?');
    expect(host.textContent).not.toContain('Try another photo');
  },
);

it('automatically routes a signed 323 approach to the reviewed arrival route at 1710', async () => {
  const { candidate } = matchedPlace('323');
  const result = await navigate(candidate);
  expect(result.status).toBe('route');
  if (result.status === 'route') {
    expect(result.destination.planId).toBe('SW3-F1-p1');
    expect(result.steps.some((s) => s.kind === 'building-link')).toBe(true);
    expect(result.origin.startRegion).toBeDefined();
  }
});

it('identifies missing connections even when a unique source doorway exists', async () => {
  const { candidate } = matchedPlace('302');
  const data = store.snapshot();
  const edge = data.candidates.find((item) => item.id === 'se12-f3-302-to-sw03-link')!.latestAnswer!
    .bindings!.edgeId;
  store.mutate({
    revision: data.document.revision,
    command: {
      type: 'review',
      target: 'edge',
      id: edge,
      status: 'rejected',
      reviewer: 'Isolated test',
      note: 'Withdraw the starting approach only in this fixture.',
    },
  });
  const result = await navigate(candidate);
  expect(result).toMatchObject({ status: 'unmapped-origin', originIssue: 'unmapped-connection' });
  await expect(checkPublishedRoute(store)).rejects.toThrow('unmapped-origin');
  await show(candidate, result);
  expect(result.mappedPortion?.requestedOrigin?.id).toBe(candidate.sourcePlaceId);
  expect(result.mappedPortion?.origin.planId).toBe(candidate.planId);
  expect(host.textContent).toContain('Directions from the first mapped stop');
  expect(host.textContent).toContain('The walk from that sign');
  expect(host.querySelector('.pin-legend')?.textContent).toContain('Matched sign · 302');
  expect(host.textContent).not.toContain('Try another photo');
});

it('ends a partial walk at a reachable public stop on the requested sheet and marks the room separately', async () => {
  const { candidate } = matchedPlace('2605');
  const snapshot = store.snapshot();
  const approval = snapshot.candidates.find(
    (c) => c.id === 'se12-f3-302-to-sw03-link',
  )!.latestAnswer!;
  store.mutate({
    revision: snapshot.document.revision,
    command: {
      type: 'review',
      target: 'edge',
      id: approval.bindings!.edgeId,
      status: 'rejected',
      reviewer: 'Isolated test',
      note: 'Remove the last room approach in this copy.',
    },
  });
  const result = await navigate(candidate, 'SE12 302');
  const partial = result.mappedPortion;
  expect(result.status).not.toBe('route');
  expect(partial?.requested).toMatchObject({ planId: 'SE12-F3-p1', label: '302' });
  expect(partial?.destination.planId).toBe('SE12-F3-p1');
  expect(partial?.steps.at(-1)?.to.point).toEqual(partial?.destination.point);
  await show(candidate, result, 'SE12 302');
  expect(host.textContent).toContain('Directions to the last mapped stop');
  const last = host.querySelector('.route-map-stack figure:last-of-type')!;
  expect(last.querySelector('.pin-legend')?.textContent).toContain('Requested place · 302');
  expect(last.querySelector('.pin-legend')?.textContent).toContain('Last mapped stop');
  expect(host.querySelector('[aria-label="Route to destination"] .floor-point-picker')).toBeNull();
});

it('automatically selects a mapped start within an estimated region', async () => {
  const { candidate: original } = matchedPlace('302');
  const candidate: CampusLocationCandidate = {
    ...original,
    sourcePlaceId: undefined,
    doorwayVicinity: undefined,
    bounds: [0, 0, 1, 1],
  };
  const result = await navigate(candidate);
  expect(result.status).toBe('route');
  expect(result.origins.length).toBeGreaterThan(1);
  if (result.status === 'route')
    expect(result.origins.map((o) => o.id)).toContain(result.origin.id);
  await show(candidate, result);
  expect(host.querySelector('.route-directions')).not.toBeNull();
  expect(host.textContent).not.toContain('Try another photo');
});

it('shows unmatched readings alongside the automatically selected source match', async () => {
  const s = newSession(),
    stamp = new Date();
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels: ['323', '98'].map((text) => ({
      text,
      kind: 'room',
      clarity: 'clear',
      placement: 'door',
      viewId: 'full',
    })),
    observations: ['Three doors are visible.'],
    readAt: stamp.toISOString(),
    expiresAt: new Date(+stamp + 300000).toISOString(),
    usedFallbackModel: false,
  };
  s.photoEvidence = evidence;
  const analysis = locateFromLabels(
    s,
    { requestId: randomUUID(), revision: 0, evidenceId: evidence.id, gps: gpsHint('SE12') },
    { sessionId: s.id, evidence, fingerprint: 'signs', buildingHint: 'SE12' },
  );
  await act(async () =>
    root.render(
      createElement(CampusLocationResults, {
        analysis,
        plans: store.plans,
        readings: evidence.labels,
      }),
    ),
  );
  expect(s.campusLocation?.id).toBe(analysis.candidates[0].id);
  expect(host.textContent).toContain('98');
  expect(host.querySelector('[aria-label="Starting location choices"]')).toBeNull();
  expect(host.textContent).toContain('no floor-plan match');
});

it('displays the automatically selected source-backed corridor without confirmation controls', async () => {
  const s = newSession(),
    stamp = new Date();
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels: ['2695', '2680'].map((text) => ({
      text,
      kind: 'room',
      clarity: 'clear',
      placement: 'directional-sign',
      viewId: 'full',
    })),
    observations: ['Two doors.'],
    features: { visibleDoorCount: 2, windowsSide: 'not-visible', corridorShape: 'straight' },
    readAt: stamp.toISOString(),
    expiresAt: new Date(+stamp + 300000).toISOString(),
    usedFallbackModel: true,
  };
  s.photoEvidence = evidence;
  const analysis = locateFromLabels(
    s,
    { requestId: randomUUID(), revision: 0, evidenceId: evidence.id, gps: gpsHint('SW3') },
    { sessionId: s.id, evidence, fingerprint: 'two-plaques' },
  );
  await act(async () =>
    root.render(
      createElement(CampusLocationResults, {
        analysis,
        plans: store.plans,
        readings: evidence.labels,
      }),
    ),
  );
  expect(s.campusLocation?.corridorOrigin?.roomLabels).toEqual(['2680', '2695']);
  expect(host.querySelector('[aria-label="Confirm starting corridor"]')).toBeNull();
  expect(host.querySelector('button')).toBeNull();
});
