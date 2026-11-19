/** Bind a session's source occurrence and destination to their public walking approaches. */
import type { CampusLocationCandidate } from '../src/types';
import type { NavigationChoice, NavigationResult, PlaceChoice } from '../src/wayfinding';
import { planLabel } from '../src/topology';
import {
  floorGraphs,
  sourceBuilding,
  landmarkKind,
  visitorExclusion,
  type FloorPlace,
} from './floor-graph';
import { FloorSearch, type SearchStop, type VisitorMap } from './floor-search';
import { labelKey, pilotEvidence } from './pilot-evidence';
import { reviewedNetwork } from './pilot-network';
import { pinnedStop } from './map-points';
import { commonDoorDeparture } from './shared-corridor';
import { reachableFloorCheckpoint } from './floor-checkpoints';

type BoundPlace = { place: PlaceChoice; stops: SearchStop[]; arrivalNote?: string };
type TripContext = Pick<NavigationResult, 'origins' | 'destinations' | 'networkRevision'>;
function stopTiers(stops: SearchStop[]): SearchStop[][] {
  const groups = [
    stops.filter((s) => !s.stop.sharedEntrance && !s.stop.corridorVicinity),
    stops.filter((s) => s.stop.sharedEntrance),
    stops.filter((s) => s.stop.corridorVicinity),
  ].filter((group) => group.length);
  return groups.length ? groups : [[]];
}
function closeToken(a: string, b: string) {
  return a.length >= 4 && a.length === b.length && [...a].filter((c, i) => c !== b[i]).length === 1;
}
function queryParts(value: string) {
  let token = labelKey(value)
    .replace(/^(TAKE ME TO|DIRECTIONS TO|NAVIGATE TO|GO TO)\s+/, '')
    .replace(
      /^(NE|NW|SE|SW)\s*O(\d+)\b/,
      (_match, area: string, digits: string) => area + '0' + digits,
    );
  const match = /^((?:NE|NW|SE|SW)\s*-?\s*\d+)\s*(?:[-·]\s*|\s+)(.+)$/.exec(token);
  const building = match ? (sourceBuilding(match[1]) ?? 'unknown') : undefined;
  if (match) token = match[2];
  const floor = /^FLOOR\s+(\d+)\s*[·-]?\s+(.+)$/.exec(token);
  return {
    building,
    floor: floor?.[1],
    token: (floor?.[2] ?? token).replace(/^ROOM\s+/, '').trim(),
  };
}
export class CampusJourney {
  private readonly search: FloorSearch;
  private readonly plans: Set<string>;
  constructor(
    private readonly map: VisitorMap,
    search = new FloorSearch(map),
  ) {
    this.search = search;
    this.plans = new Set(map.plans.map((p) => p.id));
  }
  stops(place: FloorPlace): SearchStop[] {
    if (visitorExclusion(place)) return [];
    const floor = floorGraphs().byId.get(place.planId)!;
    const choices: SearchStop[] = [];
    const binding = place.reviewedLanding ?? place.reviewedDoor;
    if (binding) {
      const node = this.map.nodes.find((n) => n.id === binding.nodeId);
      if (
        node?.planId === place.planId &&
        node.version === binding.version &&
        node.sourceSha256 === floor.plan.sourceSha256 &&
        node.point.x === binding.point[0] &&
        node.point.y === binding.point[1]
      ) {
        const landing = this.search.reviewed(node.id);
        if (landing) choices.push(landing);
      }
      if (place.reviewedLanding) return choices;
    }
    const uniqueOccurrence = floor.places.filter((p) => p.label === place.label).length === 1;
    const recorded = uniqueOccurrence
      ? (pilotEvidence()
          .find((p) => p.plan.id === place.planId)
          ?.drawnDoors.filter((d) => labelKey(d.room) === place.label) ?? [])
      : [];
    const usedCells = new Set<number>();
    const reviewedCoordinates = recorded
      .filter((d) => recordedDoorIds().has(d.id))
      .map((d) => d.point);
    for (const door of recorded) {
      const id = this.map.network.doors.get(door.id);
      const selected = id ? this.search.reviewed(id) : undefined;
      if (selected) choices.push(selected);
      // A source door that has a reviewed binding is governed by its live direction and status.
      // Other, physically separate doors of the room may still have usable floor-plan approaches.
      if (!recordedDoorIds().has(door.id)) continue;
      const candidates = place.cells
        .map((cell) => ({
          cell,
          d: Math.hypot(
            (floor.point(cell).x - door.point.x) * floor.plan.width,
            (floor.point(cell).y - door.point.y) * floor.plan.height,
          ),
        }))
        .sort((a, b) => a.d - b.d);
      if (candidates.length && candidates[0].d <= 18) usedCells.add(candidates[0].cell);
    }
    if (uniqueOccurrence && (place.kind === 'stairs' || place.kind === 'elevator')) {
      const landings: SearchStop[] = [];
      for (const node of this.map.nodes) {
        const prefix = node.label.split(' · ')[0];
        if (
          node.planId !== place.planId ||
          node.kind !== (place.kind === 'stairs' ? 'stair-landing' : 'elevator-stop') ||
          labelKey(prefix) !== place.label
        )
          continue;
        const landing = this.search.reviewed(node.id);
        if (landing) {
          landings.push(landing);
        }
      }
      // A marked landing already has its own approach. Its nearby grid cells
      // and door swings are different representations of the same stair sign.
      if (landings.length) return landings;
    }
    const stopLabel = place.sharedEntry
      ? place.label +
        (place.sharedHost ? ' · entrance to ' + place.sharedHost : ' · shared entrance')
      : place.roomArea
        ? place.label + ' · room area'
        : place.label;
    for (const cell of place.cells)
      if (!usedCells.has(cell)) choices.push({ key: cell, stop: floor.stop(cell, stopLabel) });
    const traced = new Set<string>();
    for (const access of place.terminalPaths ?? []) {
      const path = access.via.map(([x, y]) => ({ x, y }));
      if (
        reviewedCoordinates.some(
          (p) =>
            Math.hypot(
              (p.x - path[0].x) * floor.plan.width,
              (p.y - path[0].y) * floor.plan.height,
            ) <= 12,
        )
      )
        continue;
      traced.add(floor.thresholdId(path[0]));
      choices.push(this.search.terminal(place.planId, stopLabel, access.cell, path));
    }
    // A source doorway keeps its identity even if its public-side approach is unresolved.
    // Two adjacent rooms may legitimately name the same threshold.
    for (const [x, y, cell] of place.doors) {
      if (
        cell !== null ||
        traced.has(floor.thresholdId({ x, y })) ||
        reviewedCoordinates.some(
          (p) => Math.hypot((p.x - x) * floor.plan.width, (p.y - y) * floor.plan.height) <= 12,
        )
      )
        continue;
      choices.push(this.search.threshold(place.planId, { x, y }, place.label));
    }
    const precise = [...new Map(choices.map((c) => [c.key, c])).values()];
    if (binding || reviewedCoordinates.length) return precise;
    const keys = new Set(precise.map((s) => s.key));
    return [...precise, ...this.alternativeStops(place).filter((s) => !keys.has(s.key))];
  }
  private alternativeStops(place: FloorPlace): SearchStop[] {
    if (visitorExclusion(place) || place.reviewedDoor || place.reviewedLanding) return [];
    const floor = floorGraphs().byId.get(place.planId)!;
    const access = place.sharedAccess;
    const label = place.label + ' · entrance to ' + access?.host;
    const shared = access
      ? [
          ...access.cells.map((cell) => ({ key: cell, stop: floor.stop(cell, label) })),
          ...access.terminalPaths.map((p) =>
            this.search.terminal(
              place.planId,
              label,
              p.cell,
              p.via.map(([x, y]) => ({ x, y })),
            ),
          ),
        ].map((s) => ({ ...s, stop: { ...s.stop, sharedEntrance: access.host } }))
      : [];
    const vicinity = (place.corridorVicinities ?? []).map((v) => ({
      key: v.cell,
      stop: {
        ...floor.stop(v.cell, 'Corridor alongside ' + place.label),
        startRegion: v.bounds,
        corridorVicinity: true,
      },
    }));
    return [...shared, ...vicinity];
  }
  origins(candidate: CampusLocationCandidate): SearchStop[] {
    const floor = floorGraphs().byId.get(candidate.planId);
    if (!floor || !this.plans.has(candidate.planId)) return [];
    if (candidate.corridorOrigin) {
      const { bandId, roomPlaceIds } = candidate.corridorOrigin;
      const rooms = floor.places.filter((p) => roomPlaceIds.includes(p.id));
      if (
        rooms.length !== roomPlaceIds.length ||
        !rooms.every((p) =>
          candidate.sourceLabels?.some(
            (ref) =>
              ref.id === p.id &&
              ref.label === p.label &&
              ref.planId === floor.plan.id &&
              ref.sourceSha256 === floor.plan.sourceSha256,
          ),
        )
      )
        return [];
      const area = floor.frontages.match(rooms);
      if (!area || area.id !== bandId || candidate.sourcePlaceId !== area.corridor.id) return [];
      return [
        {
          key: area.cell,
          stop: { ...floor.stop(area.cell, area.label), startRegion: area.bounds },
        },
      ];
    }
    const place = floor.places.find((p) => p.id === candidate.sourcePlaceId);
    if (
      !place ||
      !candidate.sourceLabels?.some(
        (ref) => ref.id === place.id && ref.sourceSha256 === floor.plan.sourceSha256,
      )
    )
      return [];
    return this.stops(place);
  }
  selectableOrigins(candidate: CampusLocationCandidate) {
    const options = this.origins(candidate);
    const mapped = options.filter((option) => !option.unlinked);
    return stopTiers(mapped.length ? mapped : options)[0].map((option) => option.stop);
  }
  private destinations(value: string) {
    const { building, floor, token } = queryParts(value);
    const scoped = floorGraphs().places.filter((place) => {
      const plan = floorGraphs().byId.get(place.planId)!.plan;
      return (
        this.plans.has(plan.id) &&
        (!building || building === plan.building) &&
        (!floor || floor === plan.floor)
      );
    });
    let matches = scoped.filter(
      (p) => p.label === token || (landmarkKind(token) && p.kind === landmarkKind(token)),
    );
    const named: BoundPlace[] = [];
    for (const node of this.map.nodes) {
      const plan = floorGraphs().byId.get(node.planId)?.plan;
      if (!plan || (building && building !== plan.building) || (floor && floor !== plan.floor))
        continue;
      const published = reviewedNetwork().nodes.find(
        (n) => n.id === node.id && n.reviewContentHash === node.review?.contentHash,
      );
      const aliases = [node.label, ...(published?.aliases ?? [])];
      if (node.kind === 'stair-landing') aliases.push(node.label.split(' · ')[0]);
      if (
        !aliases.some((a) => labelKey(a) === token) &&
        !(landmarkKind(token) === 'elevator' && node.kind === 'elevator-stop') &&
        !(landmarkKind(token) === 'stairs' && node.kind === 'stair-landing') &&
        !(token === 'EXTERIOR DOOR' && node.kind === 'outdoor-access')
      )
        continue;
      const stop = this.search.reviewed(node.id);
      if (stop) named.push({ place: stop.stop, stops: [stop] });
    }
    let corrected = false;
    if (!matches.length && !named.length && /^[A-Z]?\d{3,4}[A-Z]?$/.test(token)) {
      const alternatives = [
        ...new Set(
          scoped
            .map((p) => p.label)
            .filter((l) => /^[A-Z]?\d{3,4}[A-Z]?$/.test(l) && closeToken(token, l)),
        ),
      ];
      if (alternatives.length === 1) {
        matches = scoped.filter((p) => p.label === alternatives[0]);
        corrected = true;
      }
    }
    const choices: BoundPlace[] = matches.map((p) => ({
      place: { id: p.id, planId: p.planId, label: p.label, bounds: p.bounds },
      stops: this.stops(p),
      ...(p.sharedEntry
        ? {
            arrivalNote: p.sharedHost
              ? 'Directions to ' + p.label + ' end at the shared entrance to ' + p.sharedHost + '.'
              : 'Directions to ' + p.label + ' end at the shared entrance shown on the plan.',
          }
        : {}),
    }));
    for (const record of named) {
      if (choices.some((c) => c.stops.some((s) => s.key === record.stops[0].key))) continue;
      const onFloor = choices.filter(
        (c) => c.place.planId === record.place.planId && c.place.label === token,
      );
      if (onFloor.length === 1) onFloor[0].stops.push(...record.stops);
      else choices.push(record);
    }
    return { choices, corrected };
  }
  route(candidate: CampusLocationCandidate, request: NavigationChoice): NavigationResult {
    const starts = request.originPoint
      ? [pinnedStop(candidate, 'origin', request.destination, request.originPoint, this.search)]
      : this.origins(candidate);
    const pinned =
      request.destinationPoint &&
      pinnedStop(
        candidate,
        'destination',
        request.destination,
        request.destinationPoint,
        this.search,
      );
    const { choices, corrected } = pinned
      ? { choices: [{ place: pinned.stop, stops: [pinned] }], corrected: false }
      : this.destinations(request.destination);
    const context = {
      origins: starts.map((s) => s.stop),
      destinations: choices.map((c) => c.place),
      networkRevision: this.map.doc.revision,
    };
    if (!choices.length)
      return {
        ...context,
        status: 'unknown-destination',
        message: 'No matching place was found on the supplied Burnaby floor plans.',
      };
    const goal: BoundPlace | undefined = request.destinationId
      ? choices.find((c) => c.place.id === request.destinationId)
      : choices.length === 1
        ? choices[0]
        : undefined;
    if (!goal)
      return {
        ...context,
        status: 'choose-destination',
        message: 'Select the destination shown on your floor plan.',
      };
    const targetFloor = floorGraphs().byId.get(goal.place.planId)!;
    const destinationName = planLabel(targetFloor.plan) + ' · ' + goal.place.label;
    const originPlace = floorGraphs()
      .byId.get(candidate.planId)
      ?.places.find((p) => p.id === candidate.sourcePlaceId);
    const targetPlace = targetFloor.places.find((p) => p.id === goal.place.id);
    const restricted =
      !request.originPoint && originPlace && visitorExclusion(originPlace)
        ? originPlace
        : targetPlace && visitorExclusion(targetPlace)
          ? targetPlace
          : undefined;
    if (restricted)
      return {
        ...context,
        status: 'restricted-place',
        restriction: visitorExclusion(restricted),
        message:
          planLabel(floorGraphs().byId.get(restricted.planId)!.plan) +
          ' · ' +
          restricted.label +
          (visitorExclusion(restricted) === 'staff-only'
            ? ' is staff-only.'
            : ' is a non-walking feature on the floor plan.') +
          ' Select a public location for visitor directions.',
      };
    const originGroups = stopTiers(starts),
      destinationGroups = stopTiers(goal.stops);
    const pairs = originGroups
      .flatMap((origins, i) => destinationGroups.map((ends, j) => ({ origins, ends, rank: i + j })))
      .sort((a, b) => a.rank - b.rank);
    let first: NavigationResult | undefined;
    for (const { origins, ends } of pairs) {
      if (
        request.originId &&
        starts.some((s) => s.stop.id === request.originId) &&
        !origins.some((s) => s.stop.id === request.originId)
      )
        continue;
      const result = this.between(
        candidate,
        request,
        originPlace,
        { ...goal, stops: ends },
        { ...context, origins: origins.map((s) => s.stop) },
        origins,
        destinationName,
        corrected,
      );
      first ??= result;
      if (result.status === 'route' || result.status === 'choose-origin') return result;
    }
    if (
      targetPlace &&
      first &&
      (first.status === 'unmapped-destination' || first.status === 'no-route')
    ) {
      for (const origins of originGroups) {
        const eligible = origins.filter(
          (s) => !s.unlinked && (!request.originId || s.stop.id === request.originId),
        );
        if (!eligible.length) continue;
        const reachable = this.search.reachable(eligible, this.plans);
        const checkpoint = reachableFloorCheckpoint(
          targetFloor,
          targetPlace,
          reachable,
          this.map,
          this.search,
        );
        if (!checkpoint) continue;
        const portion = this.between(
          candidate,
          request,
          originPlace,
          { place: checkpoint.stop, stops: [checkpoint] },
          { ...context, origins: eligible.map((s) => s.stop) },
          eligible,
          checkpoint.stop.label,
          false,
        );
        if (portion.status === 'choose-origin')
          return {
            ...portion,
            arrivalNote:
              'The mapped route ends at ' +
              checkpoint.stop.label +
              ' on ' +
              planLabel(targetFloor.plan) +
              '. The final walk to ' +
              targetPlace.label +
              ' is unverified.',
          };
        if (portion.status === 'route')
          return {
            ...first,
            mappedPortion: {
              origin: portion.origin,
              destination: portion.destination,
              steps: portion.steps,
              requested: goal.place,
            },
          };
      }
    }
    if (
      originPlace &&
      !request.originId &&
      !request.originPoint &&
      first &&
      (first.status === 'unmapped-origin' || first.status === 'no-route')
    ) {
      const floor = floorGraphs().byId.get(originPlace.planId)!;
      for (const ends of destinationGroups) {
        const targets = ends.filter((s) => !s.unlinked);
        if (!targets.length) continue;
        const checkpoint = reachableFloorCheckpoint(
          floor,
          originPlace,
          this.search.reachable(targets, this.plans, true),
          this.map,
          this.search,
        );
        if (!checkpoint) continue;
        const path = this.search.route([checkpoint], targets, request.preferElevators);
        if (path)
          return {
            ...first,
            mappedPortion: {
              ...path,
              requestedOrigin: {
                id: originPlace.id,
                planId: originPlace.planId,
                label: originPlace.label,
                bounds: originPlace.bounds,
              },
            },
            arrivalNote: goal.arrivalNote,
          };
      }
    }
    return first!;
  }
  private between(
    candidate: CampusLocationCandidate,
    request: NavigationChoice,
    source: FloorPlace | undefined,
    goal: BoundPlace,
    context: TripContext,
    starts: SearchStop[],
    destinationName: string,
    corrected: boolean,
  ): NavigationResult {
    if (!starts.length || !goal.stops.length) {
      const status =
        !starts.length && !goal.stops.length
          ? 'unmapped-origin-and-destination'
          : !starts.length
            ? 'unmapped-origin'
            : 'unmapped-destination';
      const messages = {
        'unmapped-origin':
          'The starting place needs a mapped approach to the public walking network.',
        'unmapped-destination':
          'The floor plan shows ' +
          destinationName +
          '. Its entrance has no mapped connection to a public corridor.',
        'unmapped-origin-and-destination':
          'The starting place and ' + destinationName + ' both need mapped walking approaches.',
      };
      return {
        ...context,
        status,
        originIssue: !starts.length ? 'unmapped-connection' : undefined,
        message: messages[status],
      };
    }
    const selected = request.originId
      ? starts.find((s) => s.stop.id === request.originId)
      : starts.length === 1
        ? starts[0]
        : undefined;
    if (
      !selected &&
      starts.every((s) => s.unlinked) &&
      !starts.some((s) => goal.stops.some((target) => s.key === target.key))
    )
      return {
        ...context,
        status: 'unmapped-origin',
        originIssue: 'unmapped-connection',
        message:
          'The starting door is marked on the floor plan. Its connection to the public walking route is missing.',
      };
    const sharedStart = source?.sharedEntry || starts.some((s) => s.stop.sharedEntrance);
    const nearbyStart = starts.some((s) => s.stop.corridorVicinity);
    const common =
      !selected && !request.originId && !request.originPoint && !candidate.corridorOrigin && source
        ? commonDoorDeparture(
            floorGraphs().byId.get(source.planId)!,
            source,
            starts,
            goal.stops,
            this.search,
            request.preferElevators,
          )
        : undefined;
    if (
      !common &&
      (!selected || ((sharedStart || nearbyStart) && !request.originId && !request.originPoint))
    ) {
      const reachable = this.search.reachable(goal.stops, this.plans, true);
      const options = starts.filter((s) => reachable.has(s.key));
      if (!options.length)
        return {
          ...context,
          origins: [],
          status: goal.stops.every((s) => s.unlinked) ? 'unmapped-destination' : 'no-route',
          message:
            'The mapped entrances do not have a continuous approach to ' + destinationName + '.',
        };
      return {
        ...context,
        origins: options.map((s) => s.stop),
        status: 'choose-origin',
        message: nearbyStart
          ? 'Confirm that you are in the marked corridor alongside this room.'
          : sharedStart
            ? 'Confirm that you are at this shared entrance to start walking.'
            : 'Which marked entrance are you beside?',
      };
    }
    if (selected && !goal.stops.some((g) => g.key === selected.key)) {
      if (selected.unlinked)
        return {
          ...context,
          status: 'unmapped-origin',
          originIssue: 'unmapped-connection',
          message:
            'The selected door is marked on the floor plan. Its connection to the public walking route is missing.',
        };
      if (goal.stops.every((s) => s.unlinked))
        return {
          ...context,
          status: 'unmapped-destination',
          message:
            destinationName +
            ' has a marked door. Its approach from the public walking route is missing.',
        };
    }
    const result =
      common ?? (selected && this.search.route([selected], goal.stops, request.preferElevators));
    if (!result)
      return {
        ...context,
        status: 'no-route',
        message:
          floorGraphs().byId.get(goal.place.planId)!.plan.building !== candidate.building
            ? 'Both places have walking approaches. The saved passages do not provide a continuous route between these buildings.'
            : 'Both places have walking approaches. A continuous connection between them is missing.',
      };
    return {
      ...context,
      status: 'route',
      ...result,
      ...('arrivalNote' in goal && goal.arrivalNote ? { arrivalNote: goal.arrivalNote } : {}),
      ...(result.destination.sharedEntrance
        ? {
            arrivalNote:
              'Directions to ' +
              destinationName +
              ' end at the shared entrance to ' +
              result.destination.sharedEntrance +
              '.',
          }
        : {}),
      ...(result.destination.corridorVicinity
        ? {
            arrivalNote:
              'Directions end in the public corridor alongside ' +
              destinationName +
              '. Check the room sign for the entrance.',
          }
        : {}),
      ...(corrected
        ? {
            destinationMatch: {
              requested: request.destination,
              matched: destinationName,
            },
          }
        : {}),
    };
  }
}
let publishedDoors: Set<string> | undefined;
function recordedDoorIds() {
  if (publishedDoors) return publishedDoors;
  // Preserve the identity of reviewed door approaches even after a local withdrawal.
  publishedDoors = new Set(
    reviewedNetwork().nodes.flatMap((node) => {
      const page = pilotEvidence().find((p) => p.plan.id === node.planId);
      return (
        page?.drawnDoors
          .filter((d) => d.point.x === node.point.x && d.point.y === node.point.y)
          .map((d) => d.id) ?? []
      );
    }),
  );
  return publishedDoors;
}
