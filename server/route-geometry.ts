/** Reject crossings of source drawing strokes. A clear line is not proof of walkability. */
import type { VisualPlan } from '../src/types';
import type { PagePoint, WalkingStep } from '../src/wayfinding';
import { planDrawingSegments } from './visual-data';

export type DrawingCrossing = { planId: string; primitiveId: string; point: PagePoint };
const numericalTolerance = 1e-8;
// Source doorway markers can lie on the ink at the start/end of a floor visit.
const endpointTolerancePdfPoints = 0.5;

function intersection(a: PagePoint, b: PagePoint, c: PagePoint, d: PagePoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const sx = d.x - c.x,
    sy = d.y - c.y;
  const denominator = dx * sy - dy * sx;
  if (Math.abs(denominator) < numericalTolerance) return undefined;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denominator;
  // A stroke's end can be the jamb of an open doorway. Its interior is a barrier warning.
  if (
    t < -numericalTolerance ||
    t > 1 + numericalTolerance ||
    u <= numericalTolerance ||
    u >= 1 - numericalTolerance
  )
    return undefined;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

const pixels = (point: PagePoint, plan: VisualPlan) => ({
  x: point.x * plan.width,
  y: point.y * plan.height,
});
const separation = (a: PagePoint, b: PagePoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Include connections between the AI polyline and its canonical displayed stops. */
export function attachPathEndpoints(
  from: PagePoint,
  path: PagePoint[],
  to: PagePoint,
): PagePoint[] {
  const points = [from, ...path, to];
  return points.filter(
    (point, index) => index === 0 || separation(point, points[index - 1]) > numericalTolerance,
  );
}

function crossingsOnFloor(path: PagePoint[], plan: VisualPlan): DrawingCrossing[] {
  const points = path.map((point) => pixels(point, plan));
  const first = points[0],
    last = points.at(-1)!;
  const crossings = new Map<string, DrawingCrossing>();
  for (const stroke of planDrawingSegments(plan)) {
    const [x0, y0, x1, y1] = stroke.coordinates;
    const start = pixels({ x: x0, y: y0 }, plan),
      end = pixels({ x: x1, y: y1 }, plan);
    for (let index = 1; index < points.length; index++) {
      const hit = intersection(points[index - 1], points[index], start, end);
      if (
        !hit ||
        separation(hit, first) <= endpointTolerancePdfPoints ||
        separation(hit, last) <= endpointTolerancePdfPoints
      )
        continue;
      crossings.set(stroke.primitiveId, {
        planId: plan.id,
        primitiveId: stroke.primitiveId,
        point: { x: hit.x / plan.width, y: hit.y / plan.height },
      });
    }
  }
  return [...crossings.values()];
}

/** Adjacent corridor steps share one check, so splitting a line at a wall cannot bypass it. */
export function routeDrawingCrossings(
  steps: WalkingStep[],
  plans: VisualPlan[],
): DrawingCrossing[] {
  const crossings: DrawingCrossing[] = [];
  let path: PagePoint[] = [],
    planId: string | undefined;
  function finishVisit() {
    if (path.length > 1) {
      const plan = plans.find((item) => item.id === planId);
      if (!plan) throw new Error('Route drawing checks require the source plan.');
      crossings.push(...crossingsOnFloor(path, plan));
    }
    path = [];
    planId = undefined;
  }
  for (const step of steps) {
    if (step.kind !== 'corridor' || (planId && planId !== step.from.planId)) finishVisit();
    if (step.kind === 'corridor') {
      planId = step.from.planId;
      path.push(...attachPathEndpoints(step.from.point, step.path, step.to.point));
    }
  }
  finishVisit();
  return crossings;
}
