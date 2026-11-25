// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import sharp from 'sharp';
import App from '../src/App';
import { preparePhoto } from '../src/photo';
import { createApp } from '../server/app';
import { reviewedNetwork } from '../server/pilot-network';
import { TopologyStore } from '../server/topology';
import { pilotEvidence } from '../server/pilot-evidence';
import { labelReading, photoInput } from './photo-fixtures';
import type { ModelPart, Provider } from '../server/provider';
import { position } from './location-fixtures';
import { locationCatalogue } from '../server/geolocation';
import type { NavigationResult } from '../src/wayfinding';

vi.mock('../src/photo', () => ({ preparePhoto: vi.fn() }));

const plans = pilotEvidence().map((p) => p.plan);
const reviewed = reviewedNetwork();
// Start from the distributable snapshot, even in a checkout with private editor changes.
const dir = mkdtempSync(join(tmpdir(), 'route-result-ui-'));
const store = new TopologyStore(join(dir, 'topology.json'), plans, undefined, () => reviewed);
let rejectLocationOnce = false;
let labelReads = 0;
let customLabelReading: (() => ModelPart[] | Promise<ModelPart[]>) | null = null;
let navigationResponse: Promise<Response> | undefined;
const provider: Provider = {
  calls: 0,
  async generate(_contents, _tools, _signal, onAttempt, options) {
    this.calls++;
    onAttempt?.();
    if (options?.forceTool !== 'read_photo_labels')
      throw Error('Only the first stage may call AI.');
    labelReads++;
    return customLabelReading ? customLabelReading() : labelReading('302', 'clear', 'SE12');
  },
};
let server: Server;
const requestBodies: string[] = [];
beforeAll(async () => {
  server = createApp({ provider, model: 'mock', liveAvailable: true, topologyStore: store }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (path: string, options?: RequestInit) => {
    if (typeof options?.body === 'string') requestBodies.push(options.body);
    if (navigationResponse && path.endsWith('/navigation')) return navigationResponse;
    if (rejectLocationOnce && path.endsWith('/photo/location')) {
      rejectLocationOnce = false;
      return Promise.resolve(
        Response.json({ error: 'Location lookup temporarily unavailable.' }, { status: 503 }),
      );
    }
    return realFetch(new URL(path, base), options);
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  if (!HTMLDialogElement.prototype.close)
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: () => {},
    });
  const data = (
    await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } })
      .jpeg()
      .toBuffer()
  ).toString('base64');
  const image = { mimeType: 'image/jpeg' as const, data };
  vi.mocked(preparePhoto).mockResolvedValue({
    ...image,
    width: 16,
    height: 16,
    preview: `data:image/jpeg;base64,${data}`,
    detailCrops: photoInput().detailCrops.map((c) => ({ ...c, image })),
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

async function wait(assertion: () => void) {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 150; attempt++) {
    // Flush network-driven React updates before checking the DOM.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    try {
      assertion();
      return;
    } catch (failure) {
      lastFailure = failure;
    }
  }
  throw lastFailure;
}

const click = (element: HTMLElement) => act(async () => element.click());
const findButton = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(name))!;

async function uploadPhoto(host: HTMLElement) {
  await wait(() => expect(findButton(host, 'Upload photo')).toBeDefined());
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Upload campus photo"]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', {
      value: [new File(['fixture'], 'test.jpg', { type: 'image/jpeg' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(() => expect(host.querySelector('#trip-destination')).not.toBeNull());
}

const enterDestination = (host: HTMLElement, value: string) =>
  act(async () => {
    const field = host.querySelector<HTMLInputElement>('#trip-destination')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

it.each([true, 'denied', 'unavailable'] as const)(
  'uses GPS by default, falls back to photo-only when unavailable, and reuses one extraction when device permission is %s',
  async (useGps) => {
    provider.calls = 0;
    requestBodies.length = 0;
    let deviceSuccess: PositionCallback = () => {};
    const ring = locationCatalogue().buildings.find((building) => building.building === 'SE12')!
      .rings[0];
    const gpsPosition = {
      ...position(),
      coords: {
        ...position().coords,
        latitude:
          (Math.min(...ring.map((point) => point[1])) +
            Math.max(...ring.map((point) => point[1]))) /
          2,
        longitude:
          (Math.min(...ring.map((point) => point[0])) +
            Math.max(...ring.map((point) => point[0]))) /
          2,
      },
    };
    const permission = Object.assign(new EventTarget(), {
      state: (useGps === 'denied' ? 'denied' : 'prompt') as PermissionState,
    });
    const getCurrentPosition = vi.fn(
      (success: PositionCallback, failure: PositionErrorCallback) => {
        if (useGps === 'denied') failure({ code: 1 } as GeolocationPositionError);
        else if (useGps === 'unavailable') failure({ code: 2 } as GeolocationPositionError);
        else {
          permission.state = 'granted';
          permission.dispatchEvent(new Event('change'));
          success({ ...gpsPosition, timestamp: Date.now() });
        }
      },
    );
    const activeWatchIds = new Set<number>();
    let lastWatchId = 0;
    const clearWatch = vi.fn((watchId: number) => activeWatchIds.delete(watchId));
    const watchPosition = vi.fn((success: PositionCallback, failure?: PositionErrorCallback) => {
      const watchId = ++lastWatchId;
      activeWatchIds.add(watchId);
      deviceSuccess = success;
      if (useGps !== true) {
        queueMicrotask(() =>
          failure?.({ code: useGps === 'denied' ? 1 : 2 } as GeolocationPositionError),
        );
      }
      return watchId;
    });
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition, watchPosition, clearWatch },
      permissions: { query: vi.fn().mockResolvedValue(permission) },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const button = (name: string) => findButton(host, name);
    const setDestination = (value: string) => enterDestination(host, value);
    try {
      await act(async () => root.render(createElement(App)));
      await uploadPhoto(host);
      await setDestination('SW03 2082');
      const elevatorOption = [...host.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('Use elevators'))!
        .querySelector<HTMLInputElement>('input')!;
      expect(elevatorOption.checked).toBe(false);
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(watchPosition).not.toHaveBeenCalled();
      expect(provider.calls).toBe(0);
      rejectLocationOnce = true;
      labelReads = 0;
      await click(button('Get Directions'));
      await wait(() => expect(button('Try again')).toBeDefined());
      expect(host.textContent).toContain('Finding your starting place stopped');
      expect(labelReads).toBe(1);
      await act(async () => {
        if (useGps === true) deviceSuccess({ ...gpsPosition, timestamp: Date.now() });
        window.dispatchEvent(
          Object.assign(new Event('deviceorientationabsolute'), { alpha: 0, beta: 0, gamma: 0 }),
        );
      });
      await click(button('Try again'));
      await wait(() => expect(host.querySelector('.guided-directions')).not.toBeNull());
      if (useGps === true) {
        expect(clearWatch).toHaveBeenCalledWith(1);
        expect(activeWatchIds).toEqual(new Set([2]));
        expect(host.querySelector('.device-position')).not.toBeNull();
        expect(host.querySelector('.device-heading-cone')).not.toBeNull();
      } else {
        expect(watchPosition).toHaveBeenCalledTimes(1);
      }
      expect(labelReads).toBe(1);
      expect(host.querySelector('.journey-evidence .floor-point-picker')).toBeNull();
      expect(host.querySelector('header.header')).toBeNull();
      expect(button('Start at')).toBeUndefined();
      expect(getCurrentPosition).toHaveBeenCalledTimes(useGps === true ? 1 : 2);
      const locationRequests = requestBodies
        .map((body) => JSON.parse(body))
        .filter((body) => body.evidenceId);
      const extractionRequests = requestBodies
        .map((body) => JSON.parse(body))
        .filter((body) => body.image);
      expect(extractionRequests).toHaveLength(1);
      expect(requestBodies.join('')).not.toMatch(/latitude|longitude/);
      expect(provider.calls).toBe(1);
      if (useGps !== true) {
        expect(locationRequests.every((body) => body.gps === undefined)).toBe(true);
        expect(extractionRequests[0].gps).toBeUndefined();
        expect(host.querySelector('.device-position')).toBeNull();
        await click(button('Overview'));
        await wait(() => expect(host.querySelector('.journey-evidence')).not.toBeNull());
        expect(host.querySelector('.journey-evidence')?.textContent).toContain(
          'GPS was unavailable; matched using photo signs only.',
        );
        return;
      }
      expect(locationRequests.every((body) => Boolean(body.gps))).toBe(true);
      expect(extractionRequests[0].gps.buildings).toContain('SE12');
      // Withdraw all interbuilding passages in this fixture; the real map has alternate stairs.
      const crossings = store
        .read()
        .edges.filter((e) => e.kind === 'building-link' || e.kind === 'outdoor');
      const reviewCrossings = (status: 'verified' | 'rejected') => {
        for (const crossing of crossings)
          store.mutate({
            revision: store.read().revision,
            command: {
              type: 'review',
              target: 'edge',
              id: crossing.id,
              status,
              reviewer: 'DOM regression',
              note: 'Isolated route recovery check.',
            },
          });
      };
      reviewCrossings('rejected');
      try {
        await click(button('Overview'));
        expect(activeWatchIds.size).toBe(0);
        await click(button('Recheck current route'));
        await wait(() => expect(button('Retry route')).toBeDefined());
        expect(activeWatchIds.size).toBe(0);
        expect(host.textContent).toContain('continuous route between these buildings');
      } finally {
        reviewCrossings('verified');
      }
      await click(button('Retry route'));
      await wait(() => expect(host.querySelector('.guided-directions')).not.toBeNull());
      expect(activeWatchIds).toEqual(new Set([3]));
      await click(button('Overview'));
      expect(activeWatchIds.size).toBe(0);
      expect(requestBodies.filter((body) => body.includes('"image":'))).toHaveLength(1);
      const result = host.querySelector('.workspace > section')!;
      expect(result.getAttribute('aria-label')).toBe('Your walking route');
      for (const label of [
        'Passage to SW03',
        'Passage to SE12',
        'S370 · beside lounge 3704',
        'S270 · beside lounge 2704',
      ])
        expect(result.textContent).toContain(label);
      expect(result.textContent).not.toMatch(/\p{Script=Hangul}/u);
      expect(
        [...result.querySelectorAll('.route-floor-label')].map((label) => label.textContent),
      ).toEqual(['SE12 · Floor 3', 'SW03 · Floor 3', 'SW03 · Floor 2']);
      const overview = result.querySelector('.route-overview')!;
      expect(overview.textContent).toBe(
        '302 · window-side corridor door → Connecting passage to SW03 · Floor 3 → Stairs at S370 · ↓ DOWN · Floor 2. → 2082 · 2000 corridor door',
      );
      const stack = result.querySelector('.route-map-stack')!;
      expect(result.querySelectorAll('.route-overview, .route-map-stack')).toHaveLength(2);
      expect(stack.querySelectorAll(':scope > figure')).toHaveLength(3);
      expect(stack.querySelectorAll('.map-bar')).toHaveLength(1);
      expect(stack.querySelectorAll('.map-credit')).toHaveLength(1);
      expect(
        [...stack.querySelectorAll('.pin-legend')].map((legend) => legend.textContent),
      ).toEqual([
        'AStart · 302 · window-side corridor doorBContinue at · Passage to SW03',
        'AEnter · Passage to SE12BContinue at · S370 · beside lounge 3704',
        'AEnter · S270 · beside lounge 2704BDestination · 2082 · 2000 corridor door',
      ]);
      expect(result.querySelectorAll('[data-walking-line=true]')).toHaveLength(3);
      const mapViewBoxes = () =>
        [...stack.querySelectorAll('.walking-map')].map((map) => map.getAttribute('viewBox'));
      const croppedViews = mapViewBoxes();
      await click(button('Show full floors'));
      expect(mapViewBoxes().every((view, index) => view !== croppedViews[index])).toBe(true);
      await click(button('Zoom to route'));
      expect(mapViewBoxes()).toEqual(croppedViews);
      expect(host.querySelector('.journey-inputs[open], .journey-evidence[open]')).toBeNull();
      expect(host.querySelector('img.evidence-photo')).toBeNull();
      expect(provider.calls).toBe(1);
      expect(result.querySelector('.route-device-controls')).toBeNull();
      await click(button('Back to steps'));
      expect(activeWatchIds).toEqual(new Set([4]));
      await act(async () => deviceSuccess({ ...gpsPosition, timestamp: Date.now() }));
      expect(result.querySelectorAll('.device-position')).toHaveLength(1);
      await click(button('Next'));
      await click(button('Next'));
      expect(result.querySelector('.device-position')).toBeNull();
      await act(async () => deviceSuccess({ ...gpsPosition, timestamp: Date.now() + 1 }));
      expect(result.querySelector('[aria-label="Current tracking floor"]')).toBeNull();
      await click(button('Overview'));
      expect(clearWatch).toHaveBeenCalledWith(4);
      expect(activeWatchIds.size).toBe(0);
      expect(result.querySelectorAll('.route-map-visit')).toHaveLength(3);
      await click(host.querySelector<HTMLElement>('.journey-inputs > summary')!);
      const preference = [...host.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('Use elevators'))!
        .querySelector<HTMLInputElement>('input')!;
      expect(preference.checked).toBe(false);
      await click(preference);
      expect(host.querySelector('.guided-directions')).toBeNull();
      await click(button('Get Directions to SW03 2082'));
      await wait(() => expect(host.querySelector('.guided-directions')).not.toBeNull());
      await click(button('Overview'));
      await wait(() =>
        expect(host.querySelector('.route-directions .helper')?.textContent).toContain(
          'Elevators only',
        ),
      );
      const navigationRequests = requestBodies
        .map((body) => JSON.parse(body))
        .filter((body) => body.candidateId && body.destination);
      expect(navigationRequests[0].preferElevators).toBe(false);
      expect(navigationRequests.at(-1).preferElevators).toBe(true);
      expect(provider.calls).toBe(1);

      await click(host.querySelector<HTMLElement>('.journey-inputs > summary')!);
      await setDestination('SW03 1730');
      await click(button('Get Directions to SW03 1730'));
      await wait(() => expect(host.querySelector('.guided-directions')).not.toBeNull());
      await click(button('Overview'));
      await wait(() =>
        expect(
          host.querySelector('.route-map-visit:last-of-type .pin-legend')?.textContent,
        ).toContain('Destination · 1730'),
      );
      const arrival = host.querySelector('.route-map-visit:last-of-type')!;
      expect(arrival.querySelector('.route-floor-label')?.textContent).toBe('SW03 · Floor 1');
      expect(arrival.querySelector('[data-walking-line=true]')).toBeTruthy();
      expect(host.querySelector('.journey-panel .floor-point-picker')).toBeNull();
      const requestsTo1730 = requestBodies
        .map((body) => JSON.parse(body))
        .filter((body) => body.destination === 'SW03 1730');
      expect(requestsTo1730).toHaveLength(1);
      expect(requestsTo1730[0]).not.toHaveProperty('destinationPoint');
      await click(host.querySelector<HTMLElement>('.journey-inputs > summary')!);
      await setDestination('SW03 2458');
      expect(host.querySelector('.route-directions')).toBeNull();
      await click(button('Get Directions to SW03 2458'));
      await wait(() =>
        expect(host.querySelector('.journey-panel h2')?.textContent).toBe('Destination not found'),
      );
      // Verify finishing a route and clicking Done returns immediately to the photo start screen.
      await click(host.querySelector<HTMLElement>('.journey-inputs > summary')!);
      await setDestination('SW03 1730');
      await click(button('Get Directions to SW03 1730'));
      await wait(() => expect(host.querySelector('.guided-directions')).not.toBeNull());
      while (button('Next')) await click(button('Next'));
      await click(button('Finish'));
      expect(host.textContent).toContain('Route complete');
      await click(button('Done'));
      await wait(() =>
        expect(host.querySelector('#location-heading')?.textContent).toBe(
          'Snap a nearby room sign',
        ),
      );
      expect(host.querySelector('.route-overview')).toBeNull();
      expect(provider.calls).toBe(1);
      expect(requestBodies.filter((body) => body.includes('confirm-campus-region'))).toHaveLength(
        0,
      );
      expect(requestBodies.join('\n')).not.toMatch(
        /"(?:latitude|longitude|receivedAt|deviceReading|locationCatalogue)"/,
      );
    } finally {
      rejectLocationOnce = false;
      await act(async () => root.unmount());
      host.remove();
    }
  },
  30_000,
);

it.each(['zero steps', 'partial route', 'no route', 'request failure'] as const)(
  'stops both pre-warm streams when the first navigation request ends with %s',
  async (outcome) => {
    let completeNavigation!: (response: Response) => void;
    navigationResponse = new Promise((resolve) => {
      completeNavigation = resolve;
    });
    const gpsPermission = Object.assign(new EventTarget(), { state: 'granted' });
    const watchPosition = vi.fn(() => 1);
    const clearWatch = vi.fn();
    const startCompass = vi.fn();
    const stopCompass = vi.fn();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', {});
    vi.stubGlobal(
      'AbsoluteOrientationSensor',
      class extends EventTarget {
        start() {
          startCompass();
        }
        stop() {
          stopCompass();
        }
      },
    );
    vi.stubGlobal('navigator', {
      permissions: { query: vi.fn().mockResolvedValue(gpsPermission) },
      geolocation: {
        watchPosition,
        clearWatch,
        getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) =>
          failure({ code: 2 } as GeolocationPositionError),
      },
    });
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(App)));
      await uploadPhoto(host);
      await enterDestination(host, 'SW03 2082');
      await click(findButton(host, 'Get Directions'));
      await wait(() => expect(host.querySelector('.journey-loading')).not.toBeNull());
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(startCompass).toHaveBeenCalledTimes(1);
      expect(clearWatch).not.toHaveBeenCalled();
      expect(stopCompass).not.toHaveBeenCalled();

      const origin = { id: 'start', planId: 'SE12-F3-p1', label: '302', point: { x: 0.3, y: 0.4 } };
      const destination = { ...origin, id: 'end', label: '303', point: { x: 0.4, y: 0.4 } };
      const metadata = { networkRevision: 1, origins: [], destinations: [] };
      const results: Record<Exclude<typeof outcome, 'request failure'>, NavigationResult> = {
        'zero steps': { ...metadata, status: 'route', origin, destination: origin, steps: [] },
        'partial route': {
          ...metadata,
          status: 'unmapped-destination',
          message: 'The route ends at the last mapped stop.',
          mappedPortion: {
            origin,
            destination,
            steps: [
              {
                kind: 'corridor',
                from: origin,
                to: destination,
                instruction: 'Follow the corridor.',
                path: [origin.point, destination.point],
              },
            ],
            requested: { ...destination, id: 'unmapped-room', label: '304' },
          },
        },
        'no route': { ...metadata, status: 'no-route', message: 'No mapped route.' },
      };
      await act(async () => {
        completeNavigation(
          outcome === 'request failure'
            ? Response.json({ error: 'Navigation unavailable.' }, { status: 503 })
            : Response.json(results[outcome]),
        );
      });
      expect(host.querySelector('.journey-loading')).toBeNull();
      expect(host.querySelector('.guided-directions')).toBeNull();
      if (outcome === 'zero steps' || outcome === 'partial route') {
        expect(host.querySelector('.overview-stage')).not.toBeNull();
      } else {
        expect(host.textContent).toContain(
          outcome === 'no route' ? 'No mapped route.' : 'Navigation unavailable.',
        );
      }
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(clearWatch.mock.calls).toEqual([[1]]);
      expect(startCompass).toHaveBeenCalledTimes(1);
      expect(stopCompass).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      navigationResponse = undefined;
      vi.stubGlobal('AbsoluteOrientationSensor', undefined);
    }
  },
);

it('cancelling analysis while GPS is pending aborts without calling the AI provider', async () => {
  provider.calls = 0;
  requestBodies.length = 0;
  const getCurrentPosition = vi.fn(() => {
    // Keep geolocation pending until the user cancels.
  });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    geolocation: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const wait = async (assertion: () => void) => {
    let lastFailure: unknown;
    for (let attempt = 0; attempt < 100; attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      try {
        assertion();
        return;
      } catch (failure) {
        lastFailure = failure;
      }
    }
    throw lastFailure;
  };
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
  try {
    await act(async () => root.render(createElement(App)));
    await wait(() => expect(button('Upload photo')).toBeDefined());
    const fileInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Upload campus photo"]',
    )!;
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['fixture'], 'test.jpg', { type: 'image/jpeg' })],
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(() => expect(host.querySelector('#trip-destination')).not.toBeNull());
    await act(async () => {
      const field = host.querySelector<HTMLInputElement>('#trip-destination')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        field,
        'SW03 2082',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Get Directions').click());
    await wait(() => expect(button('Cancel analysis')).toBeDefined());
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await act(async () => button('Cancel analysis').click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(provider.calls).toBe(0);
    expect(requestBodies.filter((body) => body.includes('"image":'))).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each(['off-campus', 'sw03-conflict'] as const)(
  'preserves initial GPS rejection (%s) when a >20s refresh fails without resubmitting stale GPS',
  async (scenario) => {
    provider.calls = 0;
    requestBodies.length = 0;
    let clockOffsetMs = 0;
    const realNow = Date.now;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs);
    const sw3Ring = locationCatalogue().buildings.find((building) => building.building === 'SW3')!
      .rings[0];
    const initialCoords =
      scenario === 'off-campus'
        ? { latitude: 49.0, longitude: -123.5 }
        : {
            latitude:
              (Math.min(...sw3Ring.map((point) => point[1])) +
                Math.max(...sw3Ring.map((point) => point[1]))) /
              2,
            longitude:
              (Math.min(...sw3Ring.map((point) => point[0])) +
                Math.max(...sw3Ring.map((point) => point[0]))) /
              2,
          };
    let captureCalls = 0;
    const getCurrentPosition = vi.fn(
      (success: PositionCallback, failure: PositionErrorCallback) => {
        captureCalls++;
        if (captureCalls === 1) {
          success({
            ...position(),
            coords: { ...position().coords, ...initialCoords },
            timestamp: Date.now(),
          });
        } else {
          // Simulate GPS disappearing indoors when the >20 s refresh runs.
          failure({ code: 3 } as GeolocationPositionError);
        }
      },
    );
    customLabelReading = () => {
      // Simulate a 25-second extraction so the initial GPS reading ages past the 20 s refresh threshold.
      clockOffsetMs += 25_000;
      return labelReading('302', 'clear', 'SE12');
    };
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const wait = async (assertion: () => void) => {
      let lastFailure: unknown;
      for (let attempt = 0; attempt < 150; attempt++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        try {
          assertion();
          return;
        } catch (failure) {
          lastFailure = failure;
        }
      }
      throw lastFailure;
    };
    const button = (name: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
    try {
      await act(async () => root.render(createElement(App)));
      await wait(() => expect(button('Upload photo')).toBeDefined());
      const fileInput = host.querySelector<HTMLInputElement>(
        'input[aria-label="Upload campus photo"]',
      )!;
      await act(async () => {
        Object.defineProperty(fileInput, 'files', {
          value: [new File(['fixture'], 'test.jpg', { type: 'image/jpeg' })],
        });
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await wait(() => expect(host.querySelector('#trip-destination')).not.toBeNull());
      await act(async () => {
        const field = host.querySelector<HTMLInputElement>('#trip-destination')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          field,
          'SW03 2082',
        );
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Get Directions').click());
      await wait(() =>
        expect(host.querySelector('.journey-panel h2')?.textContent).toBe(
          'Couldn’t find your starting point',
        ),
      );
      expect(host.querySelector('.guided-directions')).toBeNull();
      expect(host.textContent).toContain('The device reading does not agree with the photo matches.');
      expect(host.textContent).not.toContain('matched using photo signs only');
      expect(getCurrentPosition).toHaveBeenCalledTimes(2);
      const locationRequests = requestBodies
        .map((body) => JSON.parse(body))
        .filter((body) => body.evidenceId);
      expect(locationRequests).toHaveLength(1);
      // Stale GPS metadata must not be resubmitted when refresh fails.
      expect(locationRequests[0].gps).toBeUndefined();
    } finally {
      customLabelReading = null;
      nowSpy.mockRestore();
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it('falls back to photo-only starting detection on plain HTTP when crypto.randomUUID is unavailable', async () => {
  provider.calls = 0;
  requestBodies.length = 0;
  const originalCrypto = globalThis.crypto;
  vi.stubGlobal('isSecureContext', false);
  vi.stubGlobal('crypto', {
    getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
  });
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const wait = async (assertion: () => void) => {
    let lastFailure: unknown;
    for (let attempt = 0; attempt < 150; attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      try {
        assertion();
        return;
      } catch (failure) {
        lastFailure = failure;
      }
    }
    throw lastFailure;
  };
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
  try {
    await act(async () => root.render(createElement(App)));
    await wait(() => expect(button('Upload photo')).toBeDefined());
    const fileInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Upload campus photo"]',
    )!;
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['fixture'], 'test.jpg', { type: 'image/jpeg' })],
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(() => expect(host.querySelector('#trip-destination')).not.toBeNull());
    await act(async () => {
      const field = host.querySelector<HTMLInputElement>('#trip-destination')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        field,
        'SW03 2082',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Get Directions').click());
    await wait(() => expect(host.querySelector('.guided-directions')).not.toBeNull());
    await act(async () => button('Overview').click());
    await wait(() => expect(button('Start over')).toBeDefined());
    await act(async () => button('Start over').click());
    await wait(() =>
      expect(host.querySelector('#location-heading')?.textContent).toBe('Snap a nearby room sign'),
    );
    const parsed = requestBodies.map((body) => JSON.parse(body));
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const withRequestIds = parsed.filter((body) => typeof body.requestId === 'string');
    expect(withRequestIds.length).toBeGreaterThanOrEqual(3);
    expect(withRequestIds.every((body) => uuidPattern.test(body.requestId))).toBe(true);
    expect(parsed.filter((body) => body.image || body.evidenceId).every((b) => !b.gps)).toBe(true);
  } finally {
    vi.stubGlobal('crypto', originalCrypto);
    await act(async () => root.unmount());
    host.remove();
  }
});

it('uses search wording instead of matched wording in Location evidence when photo-only fallback finds no match', async () => {
  provider.calls = 0;
  requestBodies.length = 0;
  customLabelReading = () => labelReading('99999', 'clear');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const wait = async (assertion: () => void) => {
    let lastFailure: unknown;
    for (let attempt = 0; attempt < 150; attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      try {
        assertion();
        return;
      } catch (failure) {
        lastFailure = failure;
      }
    }
    throw lastFailure;
  };
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
  try {
    await act(async () => root.render(createElement(App)));
    await wait(() => expect(button('Upload photo')).toBeDefined());
    const fileInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Upload campus photo"]',
    )!;
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['fixture'], 'test.jpg', { type: 'image/jpeg' })],
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(() => expect(host.querySelector('#trip-destination')).not.toBeNull());
    await act(async () => {
      const field = host.querySelector<HTMLInputElement>('#trip-destination')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        field,
        'SW03 2082',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Get Directions').click());
    await wait(() =>
      expect(host.querySelector('.journey-panel h2')?.textContent).toBe(
        'Couldn’t find your starting point',
      ),
    );
    const evidenceText = host.querySelector('.journey-evidence')?.textContent ?? '';
    expect(evidenceText).toContain('GPS was unavailable; searched using photo signs only.');
    expect(evidenceText).not.toContain('matched using photo signs only');
  } finally {
    customLabelReading = null;
    await act(async () => root.unmount());
    host.remove();
  }
});
