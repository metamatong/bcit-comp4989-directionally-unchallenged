/** Mock route transport using source-linked endpoints. This does not verify walkability. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pilotEvidence } from '../server/pilot-evidence';
import { reviewedNetwork } from '../server/pilot-network';
import { readConnectionCandidates } from '../server/topology-candidates';
import { lookupPilotLabels } from '../server/spatial-retrieval';
import type { ModelPart } from '../server/provider';
import type { CampusLocationCandidate } from '../src/types';
import type { MapStop, PagePoint, WalkingStep } from '../src/wayfinding';

type GeneratedStop = Omit<MapStop, 'id'>;
type GeneratedStep = Omit<WalkingStep, 'from' | 'to'> & {
  from: GeneratedStop;
  to: GeneratedStop;
  connectionId?: string;
};
export type GeneratedRoute = {
  outcome: 'route';
  explanation: string;
  destinationId: string;
  origin: GeneratedStop;
  destination: GeneratedStop;
  steps: GeneratedStep[];
};

function checkpoint(label: string): GeneratedStop {
  const node = reviewedNetwork().nodes.find((item) => item.label === label)!;
  return { planId: node.planId, label: node.label, point: node.point };
}

export function walkingRouteFixture(): GeneratedRoute {
  const origin = checkpoint('302 · window-side corridor door');
  const exit = checkpoint('Passage to SW03');
  const entrance = checkpoint('Passage to SE12');
  const upperLift = checkpoint('East elevator at 3696 · corridor 3600');
  const lowerLift = checkpoint('East elevator at 2696 · corridor 2600');
  const destination = checkpoint('2082 · 2000 corridor door');
  const crossing = reviewedNetwork().edges.find((edge) => edge.kind === 'building-link')!;
  const firstTrace = readConnectionCandidates().find(
    (item) => item.id === 'se12-f3-302-to-sw03-link',
  )!.drawingTrace!;
  const corridorDrawings: {
    traces: { candidateId: string; from: PagePoint; bends: PagePoint[]; to: PagePoint }[];
  } = JSON.parse(readFileSync('data/campus/spatial/corridor-traces.json', 'utf8'));
  const upperTrace = corridorDrawings.traces.find(
    (item) => item.candidateId === 'sw3-f3-lift-to-building-link-corridor',
  )!;
  const corridor = (from: GeneratedStop, to: GeneratedStop, bends: PagePoint[]): GeneratedStep => ({
    kind: 'corridor',
    from,
    to,
    path: [from.point, ...bends, to.point],
    instruction: `Follow the corridor to ${to.label}.`,
  });
  return {
    outcome: 'route',
    explanation: 'Mocked route protocol response using the mapped indoor crossing.',
    destinationId: lookupPilotLabels({ purpose: 'destination', labels: ['SW03 2082'] }).results[0]
      .matches[0].occurrences[0].occurrenceId,
    origin,
    destination,
    steps: [
      corridor(origin, exit, firstTrace.bends),
      {
        kind: 'building-link',
        from: exit,
        to: entrance,
        connectionId: crossing.id,
        path: [],
        instruction: 'Use the mapped passage to SW03 floor 3.',
      },
      corridor(entrance, upperLift, [...upperTrace.bends].reverse()),
      {
        kind: 'elevator',
        from: upperLift,
        to: lowerLift,
        path: [],
        instruction: 'Take the elevator to SW03 floor 2.',
      },
      corridor(lowerLift, destination, [
        { x: 0.8289216, y: 0.45 },
        { x: 0.5125, y: 0.45 },
        { x: 0.5125, y: 0.1501136 },
      ]),
    ],
  };
}

export function photoStartFixture(origin = walkingRouteFixture().origin): CampusLocationCandidate {
  const plan = pilotEvidence().find((page) => page.plan.id === origin.planId)!.plan;
  return {
    id: randomUUID(),
    planId: plan.id,
    building: plan.building,
    floor: plan.floor,
    page: plan.page,
    sourceRef: plan.sourceRef,
    bounds: [
      origin.point.x - 0.005,
      origin.point.y - 0.005,
      origin.point.x + 0.005,
      origin.point.y + 0.005,
    ],
    matches: [],
    labelMatches: [],
    confidence: 'low',
    limitations: ['Mocked photo location for routing tests.'],
    verification: 'unverified-ai-hypothesis',
  };
}

export function routeResponse(route = walkingRouteFixture()): ModelPart[] {
  return [{ functionCall: { name: 'generate_walking_route', args: route } }];
}
