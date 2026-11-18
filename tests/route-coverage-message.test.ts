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
import { JourneyPanel, StartingPositionNotice } from '../src/components/JourneyPanel';
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
    { requestId: randomUUID(), revision: 0, evidenceId: evidence.id },
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

function navigate(candidate: CampusLocationCandidate) {
  return planVisitorNavigation(
    candidate,
    { revision: 1, candidateId: candidate.id, destination: 'SW03 1710' },
    store,
  );
}
async function show(candidate: CampusLocationCandidate, result: NavigationResult) {
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
          destination: 'SW03 1710',
          plans: store.plans,
          busy: false,
          onTryAnotherPhoto: vi.fn(),
        }),
      ),
    ),
  );
}

it.each([false, true])('offers the two 323 corridor doors with fallback=%s', async (fallback) => {
  const { candidate } = matchedPlace('323', fallback);
  const result = await navigate(candidate);
  expect(result.status).toBe('choose-origin');
  expect(result.origins).toHaveLength(2);
  await show(candidate, result);
  expect(host.textContent).toContain('Which doorway are you beside?');
  expect(host.textContent).not.toContain('Try another photo');
});

it('each signed 323 doorway reaches the reviewed arrival route at 1710', async () => {
  const { candidate } = matchedPlace('323');
  const choices = await navigate(candidate);
  for (const door of choices.origins) {
    const route = await planVisitorNavigation(
      candidate,
      {
        revision: 1,
        candidateId: candidate.id,
        originId: door.id,
        networkRevision: choices.networkRevision,
        destination: 'SW03 1710',
      },
      store,
    );
    expect(route.status).toBe('route');
    if (route.status === 'route') {
      expect(route.origin.id).toBe(door.id);
      expect(route.destination.planId).toBe('SW3-F1-p1');
      expect(route.steps.some((s) => s.kind === 'building-link')).toBe(true);
    }
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
  await show(candidate, result);
  expect(host.textContent).toContain('Starting route not mapped');
  expect(host.textContent).not.toContain('Try another photo');
});

it('retains the photo action for an estimated region containing several reviewed starts', async () => {
  const { candidate: original } = matchedPlace('302');
  const candidate: CampusLocationCandidate = {
    ...original,
    sourcePlaceId: undefined,
    doorwayVicinity: undefined,
    bounds: [0, 0, 1, 1],
  };
  const result = await navigate(candidate);
  expect(result).toMatchObject({ status: 'unmapped-origin', originIssue: 'ambiguous-region' });
  await show(candidate, result);
  expect(host.textContent).toContain('Starting point needs a closer match');
  expect(host.textContent).toContain('Try another photo');
});
