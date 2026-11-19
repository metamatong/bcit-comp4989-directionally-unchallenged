// @vitest-environment jsdom
/** DOM-only navigation checks with source-linked fixtures, no browser or tracking. */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteDirections } from '../src/components/RouteDirections';
import { walkingRouteFixture } from './wayfinding-fixtures';
import { pilotEvidence } from '../server/pilot-evidence';
import type { MapStop, NavigationResult } from '../src/wayfinding';

afterEach(() => vi.unstubAllGlobals());
it('opens only the current instruction, advances manually, finishes, and returns to the overview', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
          onRecheck: recheck,
        }),
      ),
    );
    expect(host.querySelectorAll('.walking-map')).toHaveLength(3);
    await click('GO');
    expect(host.querySelector('.route-overview')).toBeNull();
    expect(host.querySelectorAll('.walking-map')).toHaveLength(1);
    expect(host.textContent).toContain('Step 1 of 5');
    expect(button('Previous').disabled).toBe(true);
    await click('Next step');
    expect(host.textContent).toContain('Step 2 of 5');
    expect(host.querySelector('.walking-map')?.getAttribute('aria-label')).toContain('SE12');
    await click('Show arrival floor');
    expect(host.querySelector('.walking-map')?.getAttribute('aria-label')).toContain('SW03');
    expect(host.querySelectorAll('polyline')).toHaveLength(0);
    await click('Previous');
    expect(host.textContent).toContain('Step 1 of 5');
    for (let i = 1; i < route.steps.length; i++) await click('Next step');
    await click('Finish route');
    expect(host.textContent).toContain('Route complete');
    expect(host.textContent).toContain('your position has not been verified');
    await click('Done');
    expect(host.querySelectorAll('.walking-map')).toHaveLength(3);
    expect(recheck).not.toHaveBeenCalled();
    await click('GO');
    expect(host.textContent).toContain('Step 1 of 5');
    await click('Route overview');
    expect(host.querySelector('.route-overview')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
