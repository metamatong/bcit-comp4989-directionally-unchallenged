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
beforeAll(async () => {
  server = createApp({ provider, model: 'mock', liveAvailable: true, topologyStore: store }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (path: string, options?: RequestInit) =>
    realFetch(new URL(path, base), options),
  );
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

it('turns a photo and typed destination into the complete three-floor route after one start selection', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const wait = async (assertion: () => void) =>
    vi.waitFor(
      async () => {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 5));
        });
        assertion();
      },
      { timeout: 10_000, interval: 20 },
    );
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
    await wait(() => expect(host.querySelector('#trip-destination')).not.toBeNull());
    await setDestination('SW03 2082');
    const fileInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Upload campus photo"]',
    )!;
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['fixture'], 'test.jpg', { type: 'image/jpeg' })],
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('input[type=checkbox]')).toBeNull();
    expect(provider.calls).toBe(0);
    await click(button('Find my route'));
    await wait(() => expect(button('Start at 302')).toBeDefined());
    expect(host.querySelector('.route-directions')).toBeNull();
    expect(host.querySelector('.journey-evidence[open]')).toBeNull();
    await click(button('Start at 302'));
    await wait(() => expect(host.querySelector('.route-directions')).not.toBeNull());
    const result = host.querySelector('.workspace > section')!;
    expect(result.getAttribute('aria-label')).toBe('Your walking route');
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
    expect(provider.calls).toBe(2);
    await click(button('One floor at a time'));
    expect(result.querySelectorAll('.floor-directions')).toHaveLength(1);
    await click(button('Next floor'));
    expect(result.querySelector('.floor-directions h3')?.textContent).toBe('SW03 · Floor 3');
    await click(button('Show all floors'));
    expect(result.querySelectorAll('.floor-directions')).toHaveLength(3);
    await click(host.querySelector<HTMLElement>('.journey-inputs > summary')!);
    await setDestination('SW03 2458');
    expect(host.querySelector('.route-directions')).toBeNull();
    await click(button('Show directions to SW03 2458'));
    await wait(() =>
      expect(host.querySelector('.journey-panel [role=status]')?.textContent).toContain(
        'no exact label',
      ),
    );
    expect(provider.calls).toBe(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 15_000);
