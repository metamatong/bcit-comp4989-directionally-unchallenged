/** Bind a session's source occurrence and destination to their public walking approaches. */
import type { CampusLocationCandidate } from '../src/types';
import type { NavigationChoice, NavigationResult, PlaceChoice } from '../src/wayfinding';
import { planLabel } from '../src/topology';
import { floorGraphs, sourceBuilding, landmarkKind, type FloorPlace } from './floor-graph';
import { FloorSearch, type SearchStop, type VisitorMap } from './floor-search';
import { labelKey, pilotEvidence } from './pilot-evidence';
import { reviewedNetwork } from './pilot-network';
import { pinnedStop } from './map-points';

type BoundPlace = { place: PlaceChoice; stops: SearchStop[]; arrivalNote?: string };
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
    if (place.visitorAccess) return [];
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
          choices.push(landing);
          // The gridded corridor approach and its live landing describe the same sign.
          const cell = floor.approachAt(node.point, node)?.cell;
          if (cell !== undefined) usedCells.add(cell);
        }
      }
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
    return [...new Map(choices.map((c) => [c.key, c])).values()];
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
    return (mapped.length ? mapped : options).map((option) => option.stop);
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
    const goal = request.destinationId
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
    const originPlace = floorGraphs()
      .byId.get(candidate.planId)
      ?.places.find((p) => p.id === candidate.sourcePlaceId);
    const targetPlace = floorGraphs()
      .byId.get(goal.place.planId)
      ?.places.find((p) => p.id === goal.place.id);
    const restricted =
      !request.originPoint && originPlace?.visitorAccess
        ? originPlace
        : targetPlace?.visitorAccess
          ? targetPlace
          : undefined;
    if (restricted)
      return {
        ...context,
        status: 'restricted-place',
        message:
          planLabel(floorGraphs().byId.get(restricted.planId)!.plan) +
          ' · ' +
          restricted.label +
          ' is staff-only. Select a public location for visitor directions.',
      };
    if (!starts.length || !goal.stops.length) {
      const status =
        !starts.length && !goal.stops.length
          ? 'unmapped-origin-and-destination'
          : !starts.length
            ? 'unmapped-origin'
            : 'unmapped-destination';
      const where =
        status === 'unmapped-origin'
          ? 'The starting place'
          : status === 'unmapped-destination'
            ? 'The destination'
            : 'Both places';
      return {
        ...context,
        status,
        originIssue: !starts.length ? 'unmapped-connection' : undefined,
        message:
          where +
          (status === 'unmapped-origin-and-destination'
            ? ' need mapped approaches'
            : ' needs a mapped approach') +
          ' to the public walking network.',
      };
    }
    const source = originPlace;
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
    if (!selected || (source?.sharedEntry && !request.originId && !request.originPoint)) {
      const reachable = this.search.reachable(goal.stops, this.plans, true);
      const options = starts.filter((s) => reachable.has(s.key));
      if (!options.length)
        return {
          ...context,
          origins: [],
          status: goal.stops.every((s) => s.unlinked) ? 'unmapped-destination' : 'no-route',
          message: 'The mapped entrances do not have a continuous approach to this destination.',
        };
      return {
        ...context,
        origins: options.map((s) => s.stop),
        status: 'choose-origin',
        message: source?.sharedEntry
          ? 'Confirm that you are at this shared entrance to start walking.'
          : 'Which marked entrance are you beside?',
      };
    }
    if (!goal.stops.some((g) => g.key === selected.key)) {
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
            'The destination door is marked on the floor plan. Its approach from the public walking route is missing.',
        };
    }
    const result = this.search.route([selected], goal.stops);
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
      ...(corrected
        ? {
            destinationMatch: {
              requested: request.destination,
              matched:
                planLabel(floorGraphs().byId.get(goal.place.planId)!.plan) +
                ' · ' +
                goal.place.label,
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
