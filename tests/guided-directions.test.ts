// @vitest-environment jsdom
/** DOM-only navigation checks with source-linked fixtures, no browser or tracking. */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteDirections } from '../src/components/RouteDirections';
import { walkingRouteFixture } from './wayfinding-fixtures';
import { pilotEvidence } from '../server/pilot-evidence';
import { locationCatalogue } from '../server/geolocation';
import type { MapStop, NavigationResult } from '../src/wayfinding';

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
    steps: fixture.steps.map((s) => ({ ...s, from: stop(s.from), to: stop(s.to) })),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const recheck = vi.fn();
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  const click = (text: string) => act(async () => button(text).click());
  try {
    await act(async () =>
      root.render(
        createElement(RouteDirections, {
          route,
          plans: pilotEvidence().map((p) => p.plan),
          locationCatalogue: catalogue,
          onRecheck: recheck,
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
    expect(host.querySelector('.guided-map')?.nextElementSibling?.className).toBe('guided-step');
    expect(host.textContent).toContain('Step 1 of 5');
    expect(button('Previous').disabled).toBe(true);
    await click('Next step');
    expect(host.textContent).toContain('Step 2 of 5');
    expect(host.querySelector('.walking-map')?.getAttribute('aria-label')).toContain('SE12');
    await click('Next step');
    expect(host.querySelector('.walking-map')?.getAttribute('aria-label')).toContain('SW03');
    expect(host.querySelectorAll('[data-walking-line]')).toHaveLength(1);
    expect(route.steps[2].kind).toBe('corridor');
    const sw3 = catalogue.buildings.find((building) => building.building === 'SW3')!.rings[0];
    const sw3Latitude =
      (Math.min(...sw3.map((point) => point[1])) + Math.max(...sw3.map((point) => point[1]))) / 2;
    const sw3Longitude =
      (Math.min(...sw3.map((point) => point[0])) + Math.max(...sw3.map((point) => point[0]))) / 2;
    await emit(sw3Latitude, sw3Longitude);
    expect(host.querySelector('.device-position')).toBeNull();
    expect(host.querySelector('.guided-location-status')?.textContent).toContain(
      'floor-plan alignment is unavailable for SW03 · Floor 3',
    );
    await click('Previous');
    await click('Route overview');
    expect(host.querySelectorAll('.walking-map')).toHaveLength(3);
    await click('Back to steps');
    expect(host.textContent).toContain('Step 2 of 5');
    for (let i = 2; i < route.steps.length; i++) await click('Next step');
    await click('Finish route');
    expect(host.textContent).toContain('Route complete');
    expect(host.textContent).toContain('Location tracking stopped');
    expect(clearWatch).toHaveBeenCalled();
    await click('Done');
    expect(host.querySelectorAll('.walking-map')).toHaveLength(3);
    expect(recheck).not.toHaveBeenCalled();
    await click('Restart directions');
    expect(host.textContent).toContain('Step 1 of 5');
    await emit(se12.controls[0].latitude, se12.controls[0].longitude);
    await click('Route overview');
    expect(host.querySelector('.route-overview')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    expect(clearWatch).toHaveBeenCalled();
  }
});
