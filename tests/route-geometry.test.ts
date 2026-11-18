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
  expect(
    routeDrawingCrossings([corridor(trace.planId, trace.path)], visualPlans, trace.doorwayOpenings),
  ).toEqual([]);
});

it('requires explicit source-bound doorway apertures for the 1710 corridor', () => {
  const trace = traces.find((item) => item.planId === 'SW3-F1-p1')!;
  const steps = [corridor(trace.planId, trace.path)];
  expect(routeDrawingCrossings(steps, visualPlans).length).toBeGreaterThan(0);
  expect(routeDrawingCrossings(steps, visualPlans, trace.doorwayOpenings)).toEqual([]);
  const changedSource = trace.doorwayOpenings.map((opening) => ({
    ...opening,
    sourceSha256: '0'.repeat(64),
  }));
  expect(routeDrawingCrossings(steps, visualPlans, changedSource).length).toBeGreaterThan(0);
  const misplaced = structuredClone(trace.doorwayOpenings);
  for (const opening of misplaced) opening.bounds = [0, 0, 0.1, 0.1];
  expect(routeDrawingCrossings(steps, visualPlans, misplaced).length).toBeGreaterThan(0);
  const wrongPrimitives = trace.doorwayOpenings.map((opening) => ({
    ...opening,
    primitiveIds: ['unknown-door-stroke'],
  }));
  expect(routeDrawingCrossings(steps, visualPlans, wrongPrimitives).length).toBeGreaterThan(0);
  const untrustedSteps = steps.map((step) => ({ ...step, doorwayOpenings: trace.doorwayOpenings }));
  expect(routeDrawingCrossings(untrustedSteps, visualPlans).length).toBeGreaterThan(0);
});

it('still rejects a wall on the same PDF curve outside its doorway aperture', () => {
  const trace = traces.find((item) => item.planId === 'SW3-F1-p1')!;
  const path = [
    { x: 0.6, y: 0.48 },
    { x: 0.6, y: 0.5050505 },
    { x: 0.53, y: 0.5050505 },
  ];
  const crossings = routeDrawingCrossings(
    [corridor(trace.planId, path)],
    visualPlans,
    trace.doorwayOpenings,
  );
  const wall = crossings.find((hit) => hit.primitiveId === 'curve-52');
  expect(wall).toBeDefined();
  expect(wall!.point.x).toBeCloseTo(0.6);
  expect(wall!.point.y).toBeCloseTo(0.49288);
});

const planId = 'SW3-F3-p1';
// Keep the original diagonal as a geometry regression; this north point is not the SE12 passage.
const northCorridor = { x: 0.4875, y: 0.352 };
const stairs = { x: 0.754412, y: 0.643939 };
it('rejects a direct SW03 north-corridor-to-stairs line across the intervening rooms', () => {
  const hits = routeDrawingCrossings([corridor(planId, [northCorridor, stairs])], visualPlans);
  expect(hits.length).toBeGreaterThan(1);
  expect(hits.every((hit) => hit.planId === planId)).toBe(true);
});

it('rejects the same shortcut when a waypoint is placed exactly on a crossed stroke', () => {
  const hit = routeDrawingCrossings([corridor(planId, [northCorridor, stairs])], visualPlans)[0];
  expect(
    routeDrawingCrossings([corridor(planId, [northCorridor, hit.point, stairs])], visualPlans)
      .length,
  ).toBeGreaterThan(0);
});

it('rejects a shortcut split into adjacent corridor steps at the crossed stroke', () => {
  const hit = routeDrawingCrossings([corridor(planId, [northCorridor, stairs])], visualPlans)[0];
  const steps = [
    corridor(planId, [northCorridor, hit.point]),
    corridor(planId, [hit.point, stairs]),
  ];
  expect(routeDrawingCrossings(steps, visualPlans).length).toBeGreaterThan(0);
});

it('checks the connections from displayed markers to the AI path', () => {
  const path = [northCorridor, { x: 0.4875, y: 0.6325758 }, { x: 0.740196, y: 0.6325758 }];
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
