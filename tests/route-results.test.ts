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
import { labelReading, comparison, photoInput } from './photo-fixtures';
import type { Provider } from '../server/provider';
import { position } from './location-fixtures';
import { routeResponse } from './wayfinding-fixtures';

vi.mock('../src/photo', () => ({ preparePhoto: vi.fn() }));

const plans = pilotEvidence().map((p) => p.plan);
const reviewed = reviewedNetwork();
// Start from the distributable snapshot, even in a checkout with private editor changes.
const dir = mkdtempSync(join(tmpdir(), 'route-result-ui-'));
const store = new TopologyStore(join(dir, 'topology.json'), plans, undefined, () => reviewed);
const room = pilotEvidence()
  .find((p) => p.plan.id === 'SE12-F3-p1')!
  .drawnDoors.find((d) => d.room === '302')!;
const provider: Provider = {
  calls: 0,
  async generate(_contents, _tools, _signal, onAttempt, options) {
    this.calls++;
    onAttempt?.();
    if (options?.forceTool === 'read_photo_labels') return labelReading('302');
    if (options?.forceTool === 'generate_walking_route') return routeResponse();
    if (options?.forceTool !== 'propose_campus_locations')
      throw Error('Unexpected model operation');
    return comparison({
      outcome: 'insufficient_evidence',
      candidates: [],
      doorwayAssessments: [
        {
          doorId: room.id,
          verdict: 'supported',
          observedLabel: '302',
          signAtDoor: true,
          layoutVisibleInPhoto: true,
          layoutMatchesDrawing: true,
          relation: 'glazing-opposite-door',
          doorSide: 'right',
          glazingSide: 'left',
          photoFeature: 'Windows opposite the door bearing the sign.',
          planFeature: 'The classroom door opens onto a corridor along the exterior boundary.',
        },
      ],
    });
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

it('turns a photo and destination into a three-floor route with opt-in walking location', async () => {
  provider.calls = 0;
  requestBodies.length = 0;
  let deviceSuccess: PositionCallback = () => {};
  const getCurrentPosition = vi.fn((success: PositionCallback) => success(position()));
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
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
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
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(provider.calls).toBe(0);
    await click(button('GO'));
    await wait(() => expect(host.querySelector('.route-directions')).not.toBeNull());
    expect(host.textContent).toContain('Starting position acquired');
    expect(button('Start at')).toBeUndefined();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    const result = host.querySelector('.workspace > section')!;
    expect(result.getAttribute('aria-label')).toBe('Your walking route');
    for (const label of [
      'Passage to SW03',
      'Passage to SE12',
      'East elevator at 3696',
      'East elevator at 2696',
    ])
      expect(result.textContent).toContain(label);
    expect(result.textContent).not.toMatch(/\p{Script=Hangul}/u);
    expect([...result.querySelectorAll('.floor-directions h3')].map((h) => h.textContent)).toEqual([
      'SE12 · Floor 3',
      'SW03 · Floor 3',
      'SW03 · Floor 2',
    ]);
    expect(result.querySelectorAll('[data-walking-line=true]')).toHaveLength(3);
    expect(result.querySelectorAll('.floor-transfer')).toHaveLength(2);
    expect(result.querySelector('.route-arrival')?.textContent).toContain('2082');
    expect(host.querySelector('.journey-inputs[open], .journey-evidence[open]')).toBeNull();
    expect(host.querySelector('img.evidence-photo')).toBeNull();
    expect(provider.calls).toBe(3);
    await click(button('Show my position'));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    await act(async () => deviceSuccess(position()));
    expect(result.querySelectorAll('.device-position')).toHaveLength(1);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await click(button('One floor at a time'));
    expect(result.querySelectorAll('.floor-directions')).toHaveLength(1);
    await click(button('Next floor'));
    expect(result.querySelector('.floor-directions h3')?.textContent).toBe('SW03 · Floor 3');
    expect(result.querySelector('[aria-label="Walking device location"]')?.textContent).toContain(
      'Tracking floor · SE12 · Floor 3',
    );
    expect(result.querySelector('.device-position')).toBeNull();
    await click(button('I’m on this floor'));
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(result.querySelector('[aria-label="Walking device location"]')?.textContent).toContain(
      'Position overlay unavailable for this floor',
    );
    await click(button('Show all floors'));
    expect(result.querySelectorAll('.floor-directions')).toHaveLength(3);
    await click(host.querySelector<HTMLElement>('.journey-inputs > summary')!);
    await setDestination('SW03 2458');
    expect(host.querySelector('.route-directions')).toBeNull();
    await click(button('GO to SW03 2458'));
    await wait(() =>
      expect(host.querySelector('.journey-panel [role=status]')?.textContent).toContain(
        'did not match a room',
      ),
    );
    expect(provider.calls).toBe(3);
    expect(requestBodies.join('\n')).not.toContain('confirm-campus-region');
    expect(requestBodies.join('\n')).not.toMatch(
      /"(?:latitude|longitude|receivedAt|deviceReading|locationCatalogue)"/,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 15_000);
