/** Typed AI route contract and source-bound endpoint/transfer validation. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CampusLocationCandidate, VisualPlan } from '../src/types';
import type { TopologyNode } from '../src/topology';
import type { MapStop, PagePoint, PlaceChoice } from '../src/wayfinding';

const routePointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
const generatedStopSchema = z
  .object({
    planId: z.string().min(1),
    label: z.string().trim().min(1).max(120),
    point: routePointSchema,
  })
  .strict();
const generatedStepSchema = z
  .object({
    kind: z.enum(['corridor', 'stairs', 'elevator', 'building-link', 'outdoor']),
    from: generatedStopSchema,
    to: generatedStopSchema,
    path: z.array(routePointSchema).max(100),
    instruction: z.string().trim().min(1).max(300),
    connectionId: z.string().optional(),
  })
  .strict();
export const generatedRouteSchema = z
  .object({
    outcome: z.enum(['route', 'no-route']),
    explanation: z.string().trim().min(1).max(500),
    destinationId: z.string().optional(),
    origin: generatedStopSchema.optional(),
    destination: generatedStopSchema.optional(),
    steps: z.array(generatedStepSchema).max(40).optional(),
  })
  .strict();

export function routeTool(planIds: string[], destinationIds: string[]) {
  const point = {
    type: 'OBJECT',
    properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } },
    required: ['x', 'y'],
  };
  const stop = {
    type: 'OBJECT',
    properties: {
      planId: { type: 'STRING', enum: planIds },
      label: { type: 'STRING' },
      point,
    },
    required: ['planId', 'label', 'point'],
  };
  return {
    name: 'generate_walking_route',
    description:
      'Generate the visitor route from the supplied official floor plans. For outcome route, include destinationId, origin, destination and every route step. Copy destinationId exactly from the supplied enum. Use only the listed building connections for travel between buildings.',
    parameters: {
      type: 'OBJECT',
      properties: {
        outcome: { type: 'STRING', enum: ['route', 'no-route'] },
        explanation: { type: 'STRING' },
        destinationId: { type: 'STRING', enum: destinationIds },
        origin: stop,
        destination: stop,
        steps: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              kind: {
                type: 'STRING',
                enum: ['corridor', 'stairs', 'elevator', 'building-link', 'outdoor'],
              },
              from: stop,
              to: stop,
              path: { type: 'ARRAY', items: point },
              instruction: { type: 'STRING' },
              connectionId: { type: 'STRING' },
            },
            required: ['kind', 'from', 'to', 'path', 'instruction'],
          },
        },
      },
      required: ['outcome', 'explanation'],
    },
  };
}

function distance(a: PagePoint, b: PagePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointWithin(bounds: NonNullable<CampusLocationCandidate['bounds']>, point: PagePoint) {
  return (
    point.x >= bounds[0] && point.x <= bounds[2] && point.y >= bounds[1] && point.y <= bounds[3]
  );
}

function pointNearBounds(
  bounds: NonNullable<CampusLocationCandidate['bounds']>,
  point: PagePoint,
  padding = 0.12,
) {
  return (
    point.x >= bounds[0] - padding &&
    point.x <= bounds[2] + padding &&
    point.y >= bounds[1] - padding &&
    point.y <= bounds[3] + padding
  );
}

export function generatedRouteIssue(
  candidate: CampusLocationCandidate,
  choice: PlaceChoice,
  route: z.infer<typeof generatedRouteSchema>,
  plans: VisualPlan[],
  connectors: {
    id: string;
    kind: 'building-link' | 'outdoor';
    direction: 'forward' | 'both';
    from: TopologyNode;
    to: TopologyNode;
  }[],
) {
  const origin = route.origin,
    destination = route.destination,
    steps = route.steps;
  if (!origin || !destination || !steps?.length || !route.destinationId)
    return 'The generated route was incomplete. Both endpoints, a destination match and walking steps are required.';
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const originPlan = planById.get(origin.planId),
    destinationPlan = planById.get(destination.planId),
    requestedDestinationPlan = planById.get(choice.planId);
  if (
    !originPlan ||
    !destinationPlan ||
    !requestedDestinationPlan ||
    origin.planId !== candidate.planId ||
    destination.planId !== choice.planId ||
    originPlan.building !== candidate.building ||
    destinationPlan.building !== requestedDestinationPlan.building
  )
    return 'The generated route used a floor that did not match the photo location or destination.';
  if (candidate.doorwayVicinity) {
    if (distance(origin.point, candidate.doorwayVicinity.point) > 0.025)
      return 'The generated route started outside the doorway area identified in your photo.';
  } else if (candidate.bounds && !pointWithin(candidate.bounds, origin.point))
    return 'The generated route started outside the area identified in your photo.';
  if (choice.point) {
    if (distance(destination.point, choice.point) > 0.04)
      return 'The generated route did not end at the selected destination.';
  } else if (choice.bounds && !pointNearBounds(choice.bounds, destination.point)) {
    return 'The generated route did not end near the requested room on its floor plan.';
  }
  const closeStop = (
    a: z.infer<typeof generatedStopSchema>,
    b: z.infer<typeof generatedStopSchema>,
  ) => a.planId === b.planId && distance(a.point, b.point) <= 0.025;
  if (!closeStop(steps[0].from, origin) || !closeStop(steps.at(-1)!.to, destination))
    return 'The generated walking steps did not connect the starting point and destination.';
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index],
      fromPlan = planById.get(step.from.planId),
      toPlan = planById.get(step.to.planId);
    if (!fromPlan || !toPlan) return 'The generated route used an unavailable floor plan.';
    if (index > 0 && !closeStop(steps[index - 1].to, step.from))
      return 'The generated route contained disconnected walking segments.';
    if (step.kind === 'corridor') {
      if (
        step.from.planId !== step.to.planId ||
        step.path.length < 2 ||
        distance(step.path[0], step.from.point) > 0.035 ||
        distance(step.path.at(-1)!, step.to.point) > 0.035
      )
        return 'A generated corridor line did not join its marked points on the same floor.';
    } else if (step.kind === 'stairs' || step.kind === 'elevator') {
      if (fromPlan.building !== toPlan.building || fromPlan.floor === toPlan.floor)
        return 'A generated stair or elevator transfer did not connect different floors of the same building.';
    } else {
      if (fromPlan.building === toPlan.building || !step.connectionId)
        return 'The generated building crossing did not identify a mapped connection.';
      const connector = connectors.find((item) => item.id === step.connectionId);
      if (
        !connector ||
        connector.kind !== step.kind ||
        !(
          (closeStop(step.from, {
            planId: connector.from.planId,
            label: connector.from.label,
            point: connector.from.point,
          }) &&
            closeStop(step.to, {
              planId: connector.to.planId,
              label: connector.to.label,
              point: connector.to.point,
            })) ||
          (connector.direction === 'both' &&
            closeStop(step.from, {
              planId: connector.to.planId,
              label: connector.to.label,
              point: connector.to.point,
            }) &&
            closeStop(step.to, {
              planId: connector.from.planId,
              label: connector.from.label,
              point: connector.from.point,
            }))
        )
      )
        return 'The generated building crossing did not match a mapped connection and its permitted direction.';
    }
  }
  return undefined;
}

export function generatedStop(stopValue: z.infer<typeof generatedStopSchema>): MapStop {
  return { ...stopValue, id: randomUUID() };
}
