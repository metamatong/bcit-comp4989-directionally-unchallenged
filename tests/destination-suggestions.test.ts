// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { reviewedNetwork } from '../server/pilot-network';
import { TopologyStore } from '../server/topology';
import { pilotDestinations } from '../server/wayfinding';
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
    const values = new Set(items.map((item) => item.value));
    const buildings = new Set(items.map((item) => item.building));
    expect([...buildings].sort()).toEqual(['SE12', 'SW01', 'SW03', 'SW05']);
    expect(values.has('SE12 302')).toBe(true);
    expect(values.has('SW03 2605')).toBe(true);
    expect(values.has('SW01 1106')).toBe(true);
    // Reviewed entrance doors, connected reviewed stair landings, and corridor-vicinity rooms.
    expect(values.has('SW03 1710')).toBe(true);
    for (const landing of ['SE12 S200', 'SW03 S190', 'SW03 S260', 'SW03 S370', 'SW03 S460']) {
      expect(values.has(landing)).toBe(true);
    }
    for (const vicinity of [
      'SE12 205H',
      'SE12 305A',
      'SE12 329',
      'SE12 336',
      'SW01 3314',
      'SW01 3320',
      'SW01 3321',
      'SW03 4603',
      'SW03 4702',
    ]) {
      expect(values.has(vicinity)).toBe(true);
    }
    // Disconnected stair landings with no active incoming links remain excluded.
    for (const disconnected of ['SE12 S202', 'SE12 S228', 'SW03 S280']) {
      expect(values.has(disconnected)).toBe(false);
    }
    expect(items.some((item) => item.kind === 'staff' || item.kind === 'shaft')).toBe(false);
  });

  it('reflects live topology approvals when given a TopologyStore', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pilot-destinations-'));
    try {
      const store = new TopologyStore(
        join(directory, 'topology.json'),
        undefined,
        undefined,
        reviewedNetwork,
      );
      expect(pilotDestinations(store).some((item) => item.value === 'SW03 1710')).toBe(true);

      for (const candidateId of ['sw3-f1-s160-to-1710', 'sw3-f1-s160-to-1710-corridor-1700']) {
        const snapshot = store.snapshot();
        const edgeId = snapshot.candidates.find((item) => item.id === candidateId)!.latestAnswer!
          .bindings!.edgeId;
        store.mutate({
          revision: snapshot.document.revision,
          command: {
            type: 'review',
            target: 'edge',
            id: edgeId,
            status: 'rejected',
            reviewer: 'Destination suggestion regression test',
            note: 'Withdraw only in this isolated test copy.',
          },
        });
      }

      expect(pilotDestinations(store).some((item) => item.value === 'SW03 1710')).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
