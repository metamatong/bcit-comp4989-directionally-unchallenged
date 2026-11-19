/** Exercise the published cross-building route with fixed sign evidence and the visitor's router. */
import { floorGraphs } from './floor-graph';
import { candidateFromSignMatch } from './label-localization';
import { resolveStartingSigns } from './starting-place-evidence';
import { TopologyStore } from './topology';
import { planVisitorNavigation } from './wayfinding';

export async function checkPublishedRoute(store = new TopologyStore()) {
  const signs = resolveStartingSigns([
    { text: '302', kind: 'room', placement: 'door', clarity: 'clear', viewId: 'full' },
  ]);
  const starts = signs.matches.filter((match) => match.place.planId === 'SE12-F3-p1');
  if (starts.length !== 1) throw Error('Expected one SE12 floor 3 match for room 302.');
  const start = candidateFromSignMatch(starts[0], signs.references);
  const route = await planVisitorNavigation(
    start,
    {
      revision: 0,
      candidateId: start.id,
      destination: 'SW03 1730',
    },
    store,
  );
  if (route.status !== 'route') throw Error('SE12 302 to SW03 1730 returned ' + route.status + '.');

  const floor = floorGraphs().byId.get('SW3-F1-p1')!;
  const room = floor.places.find((place) => place.label === '1730');
  const cell = floor.containingCell(route.destination.point);
  const arrival = route.steps.at(-1);
  if (
    route.origin.planId !== start.planId ||
    route.destination.planId !== floor.plan.id ||
    route.destination.label !== room?.label ||
    cell === undefined ||
    !room?.cells.includes(cell) ||
    !room.doors.some(([, , doorCell]) => doorCell !== null && floor.offset + doorCell === cell) ||
    arrival?.kind !== 'corridor' ||
    arrival.path.length < 2 ||
    !route.steps.some((step) => step.kind === 'building-link')
  ) {
    throw Error('The route must reach the SW03 1730 doorway on floor 1 via the building passage.');
  }
  return {
    status: route.status,
    graphVersion: floor.version,
    networkRevision: route.networkRevision,
    origin: { planId: start.planId, label: start.anchorLabel },
    destination: { planId: floor.plan.id, label: room.label },
    floors: [...new Set([route.origin.planId, ...route.steps.map((step) => step.to.planId)])],
  };
}
