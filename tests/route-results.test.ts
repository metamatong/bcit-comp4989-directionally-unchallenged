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
import type { Provider } from '../server/provider';
import { position } from './location-fixtures';
import { locationCatalogue } from '../server/geolocation';

vi.mock('../src/photo', () => ({ preparePhoto: vi.fn() }));

const plans = pilotEvidence().map((p) => p.plan);
const reviewed = reviewedNetwork();
// Start from the distributable snapshot, even in a checkout with private editor changes.
const dir = mkdtempSync(join(tmpdir(), 'route-result-ui-'));
const store = new TopologyStore(join(dir, 'topology.json'), plans, undefined, () => reviewed);
let rejectLocationOnce = false;
let labelReads = 0;
const provider: Provider = {
  calls: 0,
  async generate(_contents, _tools, _signal, onAttempt, options) {
    this.calls++;
    onAttempt?.();
    if (options?.forceTool !== 'read_photo_labels')
      throw Error('Only the first stage may call AI.');
    labelReads++;
    return labelReading('302');
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

it.each([false, true, 'denied'] as const)(
  'routes from one extraction with initial GPS enabled %s',
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
    const getCurrentPosition = vi.fn(
      (success: PositionCallback, failure: PositionErrorCallback) => {
        if (useGps === 'denied') failure({ code: 1 } as GeolocationPositionError);
        else success({ ...gpsPosition, timestamp: Date.now() });
      },
    );
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((success: PositionCallback) => {
      deviceSuccess = success;
      return 42;
    });
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition, watchPosition, clearWatch } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const wait = async (assertion: () => void) => {
      let lastFailure: unknown;
      // Keep network-driven React updates inside act during every polling interval.
      for (let attempt = 0; attempt < 500; attempt++) {
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
    const click = (element: HTMLElement) => act(async () => element.click());
    const button = (name: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
    const setDestination = async (value: string) =>
      act(async () => {
        const field = host.querySelector<HTMLInputElement>('#trip-destination')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          field,
          value,
        );
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
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
      await click(button('Next'));
      await setDestination('SW03 2082');
      if (useGps) await click(host.querySelector<HTMLInputElement>('input[type=checkbox]')!);
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(provider.calls).toBe(0);
      rejectLocationOnce = true;
      labelReads = 0;
      await click(button('GO'));
      await wait(() => expect(button('Try again')).toBeDefined());
      expect(host.textContent).toContain('Finding your starting place stopped');
      expect(labelReads).toBe(1);
      await click(button('Try again'));
      if (useGps !== true) {
        // This sign is printed in multiple buildings. The visitor chooses the SE12 occurrence.
        const choice = () =>
          host.querySelector<HTMLButtonElement>(
            '[aria-label="Starting location choices"] button',
          ) &&
          [
            ...host.querySelectorAll<HTMLButtonElement>(
              '[aria-label="Starting location choices"] button',
            ),
          ].find((b) => b.textContent?.includes('SE12 · Floor 3 · 302'));
        await wait(() => expect(choice()).toBeTruthy());
        await click(choice()!);
      }
      await wait(() => expect(host.querySelector('.route-directions')).not.toBeNull());
      expect(labelReads).toBe(1);
      expect(host.textContent).toContain('Starting area estimated');
      expect(button('Start at')).toBeUndefined();
      expect(getCurrentPosition).toHaveBeenCalledTimes(useGps ? 2 : 0);
      const locationRequests = requestBodies
        .map((body) => JSON.parse(body))
        .filter((body) => body.evidenceId);
      expect(locationRequests.every((body) => Boolean(body.gps) === (useGps === true))).toBe(true);
      expect(provider.calls).toBe(1);
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
      await click(button('Recheck current route'));
      await wait(() => expect(button('Retry route')).toBeDefined());
      expect(host.textContent).toContain('continuous route between these buildings');
      reviewCrossings('verified');
      await click(button('Retry route'));
      await wait(() => expect(host.querySelector('.route-directions')).not.toBeNull());
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
        '302 · window-side corridor door → Connecting passage to SW03 · Floor 3 → S370 · beside lounge 3704 (Floor 3 → 2) → 2082 · 2000 corridor door',
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
      expect(result.querySelector('.route-device-controls[open]')).toBeNull();
      await click(result.querySelector<HTMLElement>('.route-device-controls > summary')!);
      await click(button('Show my position'));
      expect(watchPosition).toHaveBeenCalledTimes(1);
      await act(async () => deviceSuccess(position()));
      expect(result.querySelectorAll('.device-position')).toHaveLength(1);
      expect(getCurrentPosition).toHaveBeenCalledTimes(useGps ? 2 : 0);
      expect(result.querySelector('[aria-label="Walking device location"]')?.textContent).toContain(
        'Tracking floor · SE12 · Floor 3',
      );
      await click(result.querySelector<HTMLElement>('.route-device-controls > summary')!);
      expect(result.querySelector('.route-device-controls > summary')?.textContent).toContain(
        'tracking SE12 · Floor 3',
      );
      await click(result.querySelector<HTMLElement>('.route-device-controls > summary')!);
      await act(async () => {
        const floor = result.querySelector<HTMLSelectElement>(
          '[aria-label="Current tracking floor"]',
        )!;
        floor.value = '1';
        floor.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(result.querySelector('.device-position')).toBeNull();
      expect(clearWatch).toHaveBeenCalledWith(42);
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(result.querySelector('[aria-label="Walking device location"]')?.textContent).toContain(
        'Tracking floor · SW03 · Floor 3',
      );
      expect(result.querySelector('[aria-label="Walking device location"]')?.textContent).toContain(
        'Position overlay unavailable for this floor',
      );
      expect(result.querySelectorAll('.route-map-visit')).toHaveLength(3);
      await click(host.querySelector<HTMLElement>('.journey-inputs > summary')!);
      await setDestination('SW03 2458');
      expect(host.querySelector('.route-directions')).toBeNull();
      await click(button('GO to SW03 2458'));
      await wait(() =>
        expect(host.querySelector('.journey-panel h2')?.textContent).toBe('Destination not found'),
      );
      expect(provider.calls).toBe(1);
      expect(requestBodies.filter((body) => body.includes('confirm-campus-region'))).toHaveLength(
        useGps === true ? 0 : 1,
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
  15_000,
);
