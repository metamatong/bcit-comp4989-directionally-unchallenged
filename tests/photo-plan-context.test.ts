/** Check payload reduction against actual source labels, full-resolution crops and page bounds. */
import sharp from 'sharp';
import { expect, it } from 'vitest';
import {
  compactPlanGeometry,
  detailedPlanContext,
  shortlistOverview,
} from '../server/photo-plan-context';
import { getVisualPlan, planGeometrySummary } from '../server/visual-data';
import { sourcePhotoReferences } from '../server/photo-grounding';
import { retrieveRoomLabels } from '../server/room-labels';

it('retains every exact source label and coordinate in the compact representation', () => {
  const plan = getVisualPlan('SE12-F3-p1');
  const source = planGeometrySummary(plan);
  const compact = compactPlanGeometry(plan);
  expect(compact.labels).toEqual(
    source.labels.map((label) => [label.text, label.bbox, label.method, label.verified]),
  );
  expect(compact.omittedLabelCount).toBe(0);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(source).length * 0.7);
});

it('uses one overview and the matching doorway crop for the 302 source reference', async () => {
  const plan = getVisualPlan('SE12-F3-p1');
  const retrieval = retrieveRoomLabels(
    [{ text: '302', clarity: 'clear', viewId: 'full' }],
    new Set([plan.id]),
  );
  const context = await detailedPlanContext([plan], sourcePhotoReferences(retrieval, [plan]));
  expect(context.parts.filter((part) => part.inlineData)).toHaveLength(2);
  expect(context.doorways).toHaveLength(1);
  expect(context.parts.flatMap((part) => part.text ?? []).join(' ')).toContain('sourceSha256');
});

it('retains quadrant coverage when no label-bound region is available', async () => {
  const context = await detailedPlanContext([getVisualPlan('SW3-F3-p1')], []);
  expect(context.parts.filter((part) => part.inlineData)).toHaveLength(5);
  expect(context.detailCount).toBe(4);
});

it('reduces shortlist overview dimensions without cropping the page', async () => {
  const plan = getVisualPlan('SW3-F3-p1');
  const part = await shortlistOverview(plan);
  const image = await sharp(Buffer.from(part.inlineData!.data, 'base64')).metadata();
  expect(Math.max(image.width!, image.height!)).toBe(900);
  expect(image.width! / image.height!).toBeCloseTo(plan.overview.width / plan.overview.height, 2);
});
