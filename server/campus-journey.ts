/** Bind a session's source occurrence and destination to their public walking approaches. */
import type { CampusLocationCandidate } from '../src/types';
import type { NavigationChoice, NavigationResult, PlaceChoice } from '../src/wayfinding';
import { planLabel } from '../src/topology';
import { floorGraphs, sourceBuilding, landmarkKind, type FloorPlace } from './floor-graph';
import { FloorSearch, type SearchStop, type VisitorMap } from './floor-search';
import { labelKey, pilotEvidence } from './pilot-evidence';
import { reviewedNetwork } from './pilot-network';

type BoundPlace = { place: PlaceChoice; stops: SearchStop[] };
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
  constructor(private readonly map: VisitorMap) {
    this.search = new FloorSearch(map);
    this.plans = new Set(map.plans.map((p) => p.id));
  }
  private stops(place: FloorPlace): SearchStop[] {
    const floor = floorGraphs().byId.get(place.planId)!;
    const uniqueOccurrence = floor.places.filter((p) => p.label === place.label).length === 1;
    const recorded = uniqueOccurrence
      ? (pilotEvidence()
          .find((p) => p.plan.id === place.planId)
          ?.drawnDoors.filter((d) => labelKey(d.room) === place.label) ?? [])
      : [];
    const choices: SearchStop[] = [];
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
    for (const cell of place.cells)
      if (!usedCells.has(cell)) choices.push({ key: cell, stop: floor.stop(cell, place.label) });
    // A source doorway keeps its identity even if its public-side approach is unresolved.
    // Two adjacent rooms may legitimately name the same threshold.
    for (const [x, y, cell] of place.doors) {
      if (
        cell !== null ||
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
    const starts = this.origins(candidate),
      { choices, corrected } = this.destinations(request.destination);
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
    if (!selected)
      return {
        ...context,
        status: 'choose-origin',
        message: 'Which marked doorway are you beside?',
      };
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
