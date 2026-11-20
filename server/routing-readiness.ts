/** Exercise the published cross-building routes with fixed sign evidence and the visitor's router. */
import { buildingLabel } from '../src/topology';
import type { WalkingStep } from '../src/wayfinding';
import { floorGraphs } from './floor-graph';
import { candidateFromSignMatch } from './label-localization';
import { reviewedNetwork } from './pilot-network';
import { resolveStartingSigns } from './starting-place-evidence';
import { TopologyStore } from './topology';
import { planVisitorNavigation } from './wayfinding';

type ReferencePlans = {
  from: string;
  to: string;
  preferElevators?: boolean;
  directOutdoorPassage?: string;
};

function usesExpectedPassage(transfers: WalkingStep[], directOutdoorPassage?: string) {
  if (!directOutdoorPassage) return transfers.some((step) => step.kind === 'building-link');
  const edge = reviewedNetwork().edges.find((e) => e.sourceCandidateId === directOutdoorPassage);
  const [crossing] = transfers;
  return (
    transfers.length === 1 &&
    crossing.kind === 'outdoor' &&
    edge?.kind === 'outdoor' &&
    crossing.from.id === edge.fromNodeId &&
    crossing.to.id === edge.toNodeId
  );
}

async function checkRoomTrip(
  store: TopologyStore,
  sign: string,
  target: string,
  plans: ReferencePlans = { from: 'SE12-F3-p1', to: 'SW3-F1-p1' },
) {
  const signs = resolveStartingSigns([
    { text: sign, kind: 'room', placement: 'door', clarity: 'clear', viewId: 'full' },
  ]);
  const starts = signs.matches.filter((match) => match.place.planId === plans.from);
  if (starts.length !== 1)
    throw Error('Expected one match for ' + sign + ' on ' + plans.from + '.');
  const start = candidateFromSignMatch(starts[0], signs.references);
  const floor = floorGraphs().byId.get(plans.to)!;
  const destination = buildingLabel(floor.plan.building) + ' ' + target;
  const route = await planVisitorNavigation(
    start,
    {
      revision: 0,
      candidateId: start.id,
      destination,
      preferElevators: plans.preferElevators,
    },
    store,
  );
  if (route.status !== 'route')
    throw Error(plans.from + ' ' + sign + ' to ' + destination + ' returned ' + route.status + '.');

  const room = floor.places.find((place) => place.label === target);
  const cell = floor.containingCell(route.destination.point);
  const arrival = route.steps.at(-1);
  const transfers = route.steps.filter((step) => step.kind !== 'corridor');
  if (
    route.origin.planId !== start.planId ||
    route.destination.planId !== floor.plan.id ||
    route.destination.label !== room?.label ||
    cell === undefined ||
    !room?.cells.includes(cell) ||
    !room.doors.some(([, , doorCell]) => doorCell !== null && floor.offset + doorCell === cell) ||
    arrival?.kind !== 'corridor' ||
    arrival.path.length < 2 ||
    !usesExpectedPassage(transfers, plans.directOutdoorPassage)
  ) {
    throw Error(
      'The route must reach the mapped ' + destination + ' doorway via the expected passage.',
    );
  }
  return {
    status: route.status,
    graphVersion: floor.version,
    networkRevision: route.networkRevision,
    origin: { planId: start.planId, label: start.anchorLabel },
    destination: { planId: floor.plan.id, label: room.label },
    floors: [...new Set([route.origin.planId, ...route.steps.map((step) => step.to.planId)])],
    outdoorCrossings: transfers
      .filter((step) => step.kind === 'outdoor')
      .map((step) => ({
        from: step.from.label,
        to: step.to.label,
      })),
  };
}

export async function checkPublishedRoute(store = new TopologyStore()) {
  const original = await checkRoomTrip(store, '302', '1730');
  return {
    ...original,
    alsoVerified: [
      await checkRoomTrip(store, '323', '1750'),
      await checkRoomTrip(store, '323', '1920'),
      await checkRoomTrip(store, '1730', '1106', {
        from: 'SW3-F1-p1',
        to: 'SW1-F1-p1',
        preferElevators: true,
        directOutdoorPassage: 'sw03-f1-1602-to-sw01-f1-1501-exterior',
      }),
    ],
  };
}
