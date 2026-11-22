// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { pilotDestinations } from '../server/floor-graph';
import { filterDestinationSuggestions } from '../src/destination-suggestions';
import { PhotoLocationInput } from '../src/components/PhotoLocationInput';
import type { PreparedPhoto } from '../src/photo';

const photo: PreparedPhoto = {
  mimeType: 'image/jpeg',
  data: 'local-preview-fixture',
  preview: 'data:image/jpeg;base64,local-preview-fixture',
  width: 100,
  height: 100,
  detailCrops: [],
};

describe('pilot destination suggestions', () => {
  it('exposes only routable visitor-eligible pilot buildings with exact identifiers', () => {
    const items = pilotDestinations();
    const buildings = new Set(items.map((item) => item.building));
    expect([...buildings].sort()).toEqual(['SE12', 'SW01', 'SW03', 'SW05']);
    expect(items.some((item) => item.value === 'SE12 302')).toBe(true);
    expect(items.some((item) => item.value === 'SW03 2605')).toBe(true);
    expect(items.some((item) => item.value === 'SW01 1106')).toBe(true);
    expect(items.some((item) => item.kind === 'staff' || item.kind === 'shaft')).toBe(false);
  });

  it('ranks exact identifiers ahead of prefix and substring matches and accepts building aliases', () => {
    const sample = [
      { value: 'SW01 1302', building: 'SW01', floor: '1', label: '1302', kind: 'atrium' },
      { value: 'SE12 302A', building: 'SE12', floor: '3', label: '302A', kind: 'office' },
      { value: 'SE12 302', building: 'SE12', floor: '3', label: '302', kind: 'classroom' },
      { value: 'SW03 2605', building: 'SW03', floor: '2', label: '2605', kind: 'classroom' },
      { value: 'SW03 2600', building: 'SW03', floor: '2', label: '2600', kind: 'corridor' },
      { value: 'SW05 1840', building: 'SW05', floor: '1', label: '1840', kind: 'lecture' },
    ];
    expect(filterDestinationSuggestions(sample, '')).toEqual([]);
    expect(filterDestinationSuggestions(sample, '302').map((i) => i.value)).toEqual([
      'SE12 302',
      'SE12 302A',
      'SW01 1302',
    ]);
    expect(filterDestinationSuggestions(sample, 'sw3 26').map((i) => i.value)).toEqual([
      'SW03 2600',
      'SW03 2605',
    ]);
    expect(filterDestinationSuggestions(sample, 'SW5 184').map((i) => i.value)).toEqual([
      'SW05 1840',
    ]);
  });

  it('opens matching suggestions while typing and selects a destination cleanly from the dropdown', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onAnalyze = vi.fn();
    const list = [
      { value: 'SW03 2600', building: 'SW03', floor: '2', label: '2600', kind: 'corridor' },
      { value: 'SW03 2605', building: 'SW03', floor: '2', label: '2605', kind: 'classroom' },
      { value: 'SE12 302', building: 'SE12', floor: '3', label: '302', kind: 'classroom' },
    ];
    function Harness() {
      const [destination, setDestination] = useState('');
      return createElement(PhotoLocationInput, {
        step: 'destination',
        photo,
        ready: true,
        reading: false,
        busy: false,
        status: '',
        destination,
        destinations: list,
        onDestinationChange: setDestination,
        onPhoto: vi.fn(),
        onAnalyze,
        onDiscard: vi.fn(),
      });
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(Harness)));
      const input = host.querySelector<HTMLInputElement>('#trip-destination')!;
      expect(host.querySelector('[role="listbox"]')).toBeNull();

      await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          'SW03 26',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(options.map((el) => el.querySelector('.destination-option-value')?.textContent)).toEqual([
        'SW03 2600',
        'SW03 2605',
      ]);

      await act(async () => {
        options[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(input.value).toBe('SW03 2605');
      expect(host.querySelector('[role="listbox"]')).toBeNull();
      expect(onAnalyze).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
