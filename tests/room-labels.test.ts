import { describe, expect, it } from 'vitest';
import {
  normalizeRoomLabel,
  retrieveRoomLabels,
  RoomLabelIndex,
  roomLabelIndex,
} from '../server/room-labels';
import { getVisualPlan, planGeometrySummary, visualPlans } from '../server/visual-data';

describe('exact room-label retrieval', () => {
  const index = new RoomLabelIndex(
    ['302', '3021', '0302', '302A', 'A302', '3O2', '302-1'].map((text) => ({
      text,
      bbox: [1, 2, 3, 4],
      method: 'test',
      verified: false,
      planId: text,
      sourceRef: 'test',
      building: 'TEST',
      floor: '1',
    })),
  );
  it.each(['302', '3021', '0302', '302A', 'A302', '3O2', '302-1'])(
    'matches only the complete identifier %s',
    (query) => {
      expect(index.find(query).map((match) => match.text)).toEqual([query]);
    },
  );
  it('normalizes casing and surrounding whitespace without changing identifier characters', () => {
    expect(index.find(' 302a ').map((match) => match.text)).toEqual(['302A']);
    expect(index.find('30')).toEqual([]);
    expect(index.find('302?')).toEqual([]);
    expect(index.find('Room 302')).toEqual([]);
    expect(normalizeRoomLabel('  3 02  ')).toBe('3 02');
  });
  it('includes SE12 room 302 beyond the former first-80-label cutoff', () => {
    const geometry = planGeometrySummary(getVisualPlan('SE12-F3-p1'));
    expect(geometry.labels.findIndex((label) => label.text === '302')).toBeGreaterThan(79);
    expect(geometry.labels).toHaveLength(285);
    expect(geometry.omittedLabelCount).toBe(0);
    expect(
      roomLabelIndex()
        .find('302')
        .map((match) => match.planId),
    ).toEqual(['SE12-F3-p1']);
    expect(
      roomLabelIndex()
        .find('302')
        .some((match) => match.text === '3021'),
    ).toBe(false);
  });
  it('indexes every extracted source label and preserves actual source provenance', () => {
    const total = visualPlans.reduce(
      (sum, plan) => sum + planGeometrySummary(plan).labels.length,
      0,
    );
    expect(roomLabelIndex().labelCount).toBe(total);
    expect(total).toBe(5463);
    const match = roomLabelIndex().find('302')[0];
    expect(match.sourceRef).toBe('SE12-F3#page=1');
    expect(match.method).toBe('embedded-pdf-text');
    expect(match.verified).toBe(false);
  });
  it('restricts exact matches to eligible plans and treats uncertain readings as hints', () => {
    const all = new Set(visualPlans.map((plan) => plan.id));
    expect(
      retrieveRoomLabels([{ text: '302', clarity: 'clear', viewId: 'ne' }], all).clearMatchPlanIds,
    ).toEqual(['SE12-F3-p1']);
    expect(
      retrieveRoomLabels([{ text: '302', clarity: 'uncertain', viewId: 'ne' }], all)
        .clearMatchPlanIds,
    ).toEqual([]);
    expect(roomLabelIndex().find('302', new Set(['SW1-F3-p1']))).toEqual([]);
    expect(
      roomLabelIndex()
        .find('3021')
        .some((match) => match.planId === 'SW1-F3-p1'),
    ).toBe(true);
  });
});
