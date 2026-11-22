// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { preparePhoto } from '../src/photo';
import { newSession } from '../server/session';

vi.mock('../src/photo', () => ({ preparePhoto: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('displays oversized photo preparation errors in the red photo-failure alert', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  if (!HTMLDialogElement.prototype.close) {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: () => {},
    });
  }

  const session = newSession(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/bootstrap')) {
        return Response.json({
          mode: 'live',
          liveAvailable: true,
          photoLocalizationAvailable: true,
          provider: 'gemini',
          visualPlans: [],
          destinations: [],
          locationCatalogue: {
            sourceSha256: 'a'.repeat(64),
            buildings: [],
            floors: [],
          },
        });
      }
      if (url.endsWith('/api/sessions')) {
        return Response.json(session);
      }
      return Response.json({ error: 'Unexpected request' }, { status: 404 });
    }),
  );

  vi.mocked(preparePhoto).mockRejectedValueOnce(new Error('Choose a photo smaller than 8 MB.'));

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    await act(async () => {
      root.render(createElement(App));
    });
    for (let attempt = 0; attempt < 20 && !host.querySelector('input[aria-label="Upload campus photo"]'); attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    const fileInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Upload campus photo"]',
    );
    expect(fileInput).not.toBeNull();

    await act(async () => {
      Object.defineProperty(fileInput!, 'files', {
        value: [new File(['oversized'], 'large.jpg', { type: 'image/jpeg' })],
      });
      fileInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (let attempt = 0; attempt < 20 && !host.querySelector('.photo-failure'); attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    const alert = host.querySelector('.photo-failure');
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toBe('Choose a photo smaller than 8 MB.');
    expect(host.querySelector('.photo-status')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
