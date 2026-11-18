/** Source-plan regressions for diagonal shortcuts and waypoint/step boundary bypasses. */
import { expect, it } from 'vitest';
import { routeDrawingCrossings, attachPathEndpoints } from '../server/route-geometry';
import { readConnectionCandidates } from '../server/topology-candidates';
import { sourceCorridorTraces } from '../server/visitor-paths';
import {
  getVisualPlan,
  planDrawingSegments,
  planGeometrySummary,
  visualPlans,
} from '../server/visual-data';
import type { PagePoint, WalkingStep } from '../src/wayfinding';

function corridor(planId: string, path: PagePoint[]): WalkingStep {
  return {
    kind: 'corridor',
    from: { id: 'start', planId, label: 'Source starting point', point: path[0] },
    to: { id: 'end', planId, label: 'Source ending point', point: path.at(-1)! },
    path,
    instruction: 'Follow the floor-plan corridor.',
  };
}

const traces = sourceCorridorTraces(readConnectionCandidates(), visualPlans);
it.each(traces)('preserves the source corridor bends on $planId', (trace) => {
  expect(routeDrawingCrossings([corridor(trace.planId, trace.path)], visualPlans)).toEqual([]);
});

const planId = 'SW3-F3-p1';
const passage = { x: 0.4875, y: 0.352 };
const stairs = { x: 0.754412, y: 0.643939 };
it('rejects a direct SW03 passage-to-stairs line across the intervening rooms', () => {
  const hits = routeDrawingCrossings([corridor(planId, [passage, stairs])], visualPlans);
  expect(hits.length).toBeGreaterThan(1);
  expect(hits.every((hit) => hit.planId === planId)).toBe(true);
});

it('rejects the same shortcut when a waypoint is placed exactly on a crossed stroke', () => {
  const hit = routeDrawingCrossings([corridor(planId, [passage, stairs])], visualPlans)[0];
  expect(
    routeDrawingCrossings([corridor(planId, [passage, hit.point, stairs])], visualPlans).length,
  ).toBeGreaterThan(0);
});

it('rejects a shortcut split into adjacent corridor steps at the crossed stroke', () => {
  const hit = routeDrawingCrossings([corridor(planId, [passage, stairs])], visualPlans)[0];
  const steps = [corridor(planId, [passage, hit.point]), corridor(planId, [hit.point, stairs])];
  expect(routeDrawingCrossings(steps, visualPlans).length).toBeGreaterThan(0);
});

it('checks the connections from displayed markers to the AI path', () => {
  const path = [passage, { x: 0.4875, y: 0.6325758 }, { x: 0.740196, y: 0.6325758 }];
  const step = corridor(planId, path);
  step.from.point = stairs;
  expect(routeDrawingCrossings([step], visualPlans).length).toBeGreaterThan(0);
  expect(attachPathEndpoints(stairs, path, step.to.point)[0]).toEqual(stairs);
});

it('allows a diagonal inside the source corridor frontage', () => {
  const path = [
    { x: 0.12, y: 0.59 },
    { x: 0.14, y: 0.591 },
  ];
  expect(routeDrawingCrossings([corridor('SE12-F3-p1', path)], visualPlans)).toEqual([]);
});

it('uses every extracted long stroke instead of the smaller model preview', () => {
  const plan = getVisualPlan(planId);
  const strokes = planDrawingSegments(plan);
  const summary = planGeometrySummary(plan);
  expect(strokes).toHaveLength(summary.totalLongSegments);
  expect(strokes.length).toBeGreaterThan(summary.sampledSegmentCount);
  expect(summary).not.toHaveProperty('drawingSegments');
});
