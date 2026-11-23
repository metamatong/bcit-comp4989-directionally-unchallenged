// @vitest-environment jsdom
/** DOM-only navigation checks with source-linked fixtures, no browser or tracking. */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteDirections } from '../src/components/RouteDirections';
import { walkingRouteFixture } from './wayfinding-fixtures';
import { pilotEvidence } from '../server/pilot-evidence';
import { locationCatalogue } from '../server/geolocation';
import type { MapStop, NavigationResult, WalkingStep } from '../src/wayfinding';
import { guidedStepInstruction } from '../src/wayfinding';

afterEach(() => vi.unstubAllGlobals());
it('opens only the current instruction, advances manually, finishes, and returns to the overview', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('isSecureContext', true);
  const catalogue = locationCatalogue();
  let reportLocation: PositionCallback = () => {};
  const watchPosition = vi.fn((success: PositionCallback) => {
    reportLocation = success;
    return 42;
  });
  const clearWatch = vi.fn();
  vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
  const fixture = walkingRouteFixture();
  const stop = (point: Omit<MapStop, 'id'>): MapStop => ({
    ...point,
    id: `${point.planId}:${point.label}`,
  });
  const route: Extract<NavigationResult, { status: 'route' }> = {
    status: 'route',
    networkRevision: 1,
    origins: [],
    destinations: [],
    origin: stop(fixture.origin),
    destination: stop(fixture.destination),
    steps: fixture.steps.map((s, stepIdx) => ({
      ...s,
      instruction:
        stepIdx === 0
          ? 'Follow the window-side corridor past rooms 306, 308, 310 and 312 between room 302 and the SW03 passage at corridor 312A.'
          : s.instruction,
      from: stop(s.from),
      to: stop(s.to),
    })),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const recheck = vi.fn();
  const startOver = vi.fn();
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  const click = (text: string) => act(async () => button(text).click());
  try {
    await act(async () =>
      root.render(
        createElement(RouteDirections, {
          route,
          plans: pilotEvidence().map((p) => p.plan),
          locationCatalogue: {
            ...catalogue,
            floors: catalogue.floors.filter((floor) => floor.planId !== 'SW3-F3-p1'),
          },
          onRecheck: recheck,
          onStartOver: startOver,
        }),
      ),
    );
    expect(host.querySelectorAll('.walking-map')).toHaveLength(1);
    expect(host.textContent).toContain('Step 1 of 5');
    expect(host.textContent).toContain('Waiting for GPS…');
    const se12 = catalogue.floors.find((floor) => floor.planId === 'SE12-F3-p1')!;
    const emit = (latitude: number, longitude: number) =>
      act(async () =>
        reportLocation({
          coords: { latitude, longitude, accuracy: 5 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );
    await emit(se12.controls[0].latitude, se12.controls[0].longitude);
    expect(host.querySelector('.route-overview')).toBeNull();
    expect(host.querySelectorAll('.walking-map')).toHaveLength(1);
    expect(host.querySelector('.device-position')).not.toBeNull();
    const firstPosition = host.querySelector('.device-position circle')?.getAttribute('cx');
    await emit(se12.controls[1].latitude, se12.controls[1].longitude);
    expect(host.querySelector('.device-position circle')?.getAttribute('cx')).not.toBe(
      firstPosition,
    );
    expect(host.querySelector('.guided-map')?.nextElementSibling?.classList.contains('guided-step')).toBe(true);
    expect(host.querySelector('.sheet-handle')).toBeNull();
    expect(host.querySelector('.map-floating-fab')).toBeNull();
    expect(host.querySelector('.guided-step h2')).toBeNull();
    expect(host.querySelector('.guided-step-subtitle')).toBeNull();
    expect(host.querySelector('.guided-step-instruction')?.textContent).toBe(
      'Follow the blue line to Passage to SW03.',
    );
    expect(host.querySelector('.guided-step-instruction')?.textContent).not.toMatch(
      /306|308|310|312/,
    );
    expect(host.querySelector('.map-floor-badge')?.textContent).toBe('SE12 · Floor 3');
    expect(host.querySelector('.step-progress-fill')).not.toBeNull();
    expect(host.textContent).toContain('Step 1 of 5');
    expect(button('Back').disabled).toBe(true);
    await click('Next');
    expect(host.textContent).toContain('Step 2 of 5');
    expect(host.querySelector('.walking-map')?.getAttribute('aria-label')).toContain('SE12');
    await click('Next');
    expect(host.querySelector('.walking-map')?.getAttribute('aria-label')).toContain('SW03');
    expect(host.querySelectorAll('[data-walking-line]')).toHaveLength(1);
    expect(route.steps[2].kind).toBe('corridor');
    await click('Next');
    expect(host.querySelector('.guided-transfer-overlay')?.textContent).toContain('DOWN');
    expect(host.querySelector('.guided-transfer-overlay')?.textContent).toContain('Floor 2');
    await click('Back');
    const sw3 = catalogue.buildings.find((building) => building.building === 'SW3')!.rings[0];
    const sw3Latitude =
      (Math.min(...sw3.map((point) => point[1])) + Math.max(...sw3.map((point) => point[1]))) / 2;
    const sw3Longitude =
      (Math.min(...sw3.map((point) => point[0])) + Math.max(...sw3.map((point) => point[0]))) / 2;
    await emit(sw3Latitude, sw3Longitude);
    expect(host.querySelector('.device-position')).toBeNull();
    expect(host.querySelector('.guided-location-status')?.textContent).toContain(
      'Location unavailable on SW03 · Floor 3',
    );
    await click('Back');
    await click('Overview');
    expect(host.querySelectorAll('.walking-map')).toHaveLength(3);
    expect(host.querySelectorAll('.timeline-transfer-pill').length).toBeGreaterThan(0);
    await click('Back to steps');
    expect(host.textContent).toContain('Step 2 of 5');
    for (let i = 2; i < route.steps.length; i++) await click('Next');
    await click('Finish');
    expect(host.textContent).toContain('Route complete');
    expect(host.textContent).toContain('Route complete');
    expect(clearWatch).toHaveBeenCalled();
    await click('Done');
    expect(startOver).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.route-overview')).toBeNull();
    expect(recheck).not.toHaveBeenCalled();
    await click('Overview');
    expect(host.querySelectorAll('.walking-map')).toHaveLength(3);
    await click('Restart directions');
    expect(host.textContent).toContain('Step 1 of 5');
    await emit(se12.controls[0].latitude, se12.controls[0].longitude);
    await click('Overview');
    expect(host.querySelector('.route-overview')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    expect(clearWatch).toHaveBeenCalled();
  }
});

it('formats concise guided step instructions for every step kind without listing passed rooms', () => {
  const mkStop = (planId: string, label: string): MapStop => ({
    id: `${planId}:${label}`,
    planId,
    label,
    point: { x: 0.5, y: 0.5 },
  });
  const corridorStep: WalkingStep = {
    kind: 'corridor',
    from: mkStop('SE12-F3-p1', '302 · window-side corridor door'),
    to: mkStop('SE12-F3-p1', 'Passage to SW03'),
    instruction:
      'Follow the window-side corridor past rooms 306, 308, 310 and 312 between room 302 and the SW03 passage at corridor 312A.',
    path: [],
  };
  expect(guidedStepInstruction(corridorStep)).toBe(
    'Follow the blue line to Passage to SW03.',
  );

  const corridorPrefixStep: WalkingStep = {
    ...corridorStep,
    from: mkStop('SE12-F3-p1', 'Corridor outside room 323'),
  };
  expect(guidedStepInstruction(corridorPrefixStep)).toBe(
    'Follow the blue line to Passage to SW03.',
  );

  const stairsStep: WalkingStep = {
    kind: 'stairs',
    from: mkStop('SW3-F3-p1', 'S360 · beside shaft 3696'),
    to: mkStop('SW3-F2-p1', 'S260 · beside shaft 2696'),
    instruction: 'Take stairs.',
    path: [],
  };
  expect(guidedStepInstruction(stairsStep, { fromFloor: '3', toFloor: '2' })).toBe(
    'Take stairs at S360.',
  );

  const elevatorStep: WalkingStep = {
    kind: 'elevator',
    from: mkStop('SW3-F3-p1', 'East elevator at 3696 · corridor 3600'),
    to: mkStop('SW3-F2-p1', 'East elevator at 2696 · corridor 2600'),
    instruction: 'Take elevator.',
    path: [],
  };
  expect(guidedStepInstruction(elevatorStep, { fromFloor: '3', toFloor: '2' })).toBe(
    'Take East elevator at 3696.',
  );

  const linkStep: WalkingStep = {
    kind: 'building-link',
    from: mkStop('SE12-F3-p1', 'Passage to SW03'),
    to: mkStop('SW3-F3-p1', 'Passage to SE12'),
    instruction: 'Cross passage.',
    path: [],
  };
  expect(guidedStepInstruction(linkStep, { targetPlanLabel: 'SW03 · Floor 3' })).toBe(
    'Take the passage to SW03 · Floor 3.',
  );

  const outdoorStep: WalkingStep = {
    kind: 'outdoor',
    from: mkStop('SW3-F1-p1', 'Door toward SW01 · lobby 1602'),
    to: mkStop('SW1-F1-p1', 'Door toward SW03 · vestibule 1098'),
    instruction: 'Walk outside.',
    path: [],
  };
  expect(guidedStepInstruction(outdoorStep, { targetPlanLabel: 'SW01 · Floor 1' })).toBe(
    'Go outside to SW01 · Floor 1. Path not mapped.',
  );
});
