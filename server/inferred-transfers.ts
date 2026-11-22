/** Infer same-building floor transfers from source-backed stair/elevator landings. */
import { createHash } from 'node:crypto';
import type { TopologyEdge, TopologyNode } from '../src/topology';
import type { PlanBounds, VisualPlan } from '../src/types';
import { fitCalibration } from '../src/location/geometry';
import { locationCatalogue } from './geolocation';
import { pilotEvidence } from './pilot-evidence';
import { floorGraphs, type FloorGraph } from './floor-graph';

// These buildings retain source-bound landing nodes from the original imported network.
const legacyLandingBuildings = new Set(['SE12', 'SW3', 'SW1']);
const transferKinds = new Set(['stair-landing', 'elevator-stop']);
// Runtime inference is derived from the current snapshot and has no field-observation date.
const generatedAt = new Date().toISOString();

function stableUuid(value: string) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stairSuffix(node: TopologyNode) {
  const label = /^S?(\d{3,4})\b/i.exec(node.label)?.[1];
  return label ? label.slice(-2) : undefined;
}

function landingHasApproach(node: TopologyNode) {
  const floor = floorGraphs().byId.get(node.planId);
  return !!floor && !!floor.approachAt(node.point, node);
}

function candidateCost(from: TopologyNode, to: TopologyNode) {
  const distance = Math.hypot(from.point.x - to.point.x, from.point.y - to.point.y);
  if (from.kind === 'elevator-stop') return distance <= 0.28 ? distance : undefined;

  const fromSuffix = stairSuffix(from),
    toSuffix = stairSuffix(to);
  if (fromSuffix && fromSuffix === toSuffix) return distance - 1;
  // If labels changed between levels, only pair landings that nearly overlap on the sheets.
  return distance <= 0.24 ? distance : undefined;
}

function adjacentFloorPairs(nodes: TopologyNode[], planIndex: Map<string, VisualPlan>) {
  const byBuilding = new Map<string, TopologyNode[]>();
  for (const node of nodes) {
    const plan = planIndex.get(node.planId);
    if (!plan || !legacyLandingBuildings.has(plan.building) || !transferKinds.has(node.kind))
      continue;
    if (!landingHasApproach(node)) continue;
    const group = byBuilding.get(plan.building) ?? [];
    group.push(node);
    byBuilding.set(plan.building, group);
  }

  const pairs: [TopologyNode, TopologyNode][] = [];
  for (const group of byBuilding.values()) {
    const byFloor = new Map<string, TopologyNode[]>();
    for (const node of group) {
      const floor = planIndex.get(node.planId)!.floor;
      const sameFloor = byFloor.get(floor) ?? [];
      sameFloor.push(node);
      byFloor.set(floor, sameFloor);
    }
    const floors = [...byFloor.keys()].sort((a, b) => Number(a) - Number(b));
    for (let index = 1; index < floors.length; index++) {
      if (Number(floors[index]) - Number(floors[index - 1]) !== 1) continue;
      const lower = byFloor.get(floors[index - 1])!,
        upper = byFloor.get(floors[index])!;
      const possible = lower.flatMap((from) =>
        upper.flatMap((to) => {
          if (from.kind !== to.kind) return [];
          const cost = candidateCost(from, to);
          return cost === undefined ? [] : [{ from, to, cost }];
        }),
      );
      possible.sort((a, b) => a.cost - b.cost || a.from.id.localeCompare(b.from.id));
      const used = new Set<string>();
      for (const candidate of possible) {
        if (used.has(candidate.from.id) || used.has(candidate.to.id)) continue;
        used.add(candidate.from.id);
        used.add(candidate.to.id);
        pairs.push([candidate.from, candidate.to]);
      }
    }
  }
  return pairs;
}

function inferredEdge([from, to]: [TopologyNode, TopologyNode]): TopologyEdge {
  const kind = from.kind === 'elevator-stop' ? 'elevator' : 'stairs';
  const id = stableUuid(`inferred:${kind}:${from.id}:${to.id}`);
  const evidence = {
    basis: 'plan' as const,
    note: `Inferred from matching source-plan ${kind} landings on adjacent floors.`,
    observedOn: null,
  };
  const contentHash = createHash('sha256')
    .update(`${id}:${from.version}:${to.version}`)
    .digest('hex');
  const review = {
    status: 'verified' as const,
    reviewer: 'source-plan inference',
    note: 'Generated from source-plan landing correspondence.',
    reviewedAt: generatedAt,
    recordVersion: 1,
    contentHash,
    evidence,
  };
  return {
    id,
    version: 1,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    notes: 'Automatically inferred from adjacent source-plan landing records.',
    evidence,
    review,
    reviewHistory: [review],
    fromNodeId: from.id,
    toNodeId: to.id,
    kind,
    direction: 'both',
    endpointVersions: { from: from.version, to: to.version },
    distanceMeters: null,
    distanceEvidence: '',
  };
}

/** Legacy landing inputs are still paired at request time. */
export function inferSameBuildingTransfers(nodes: TopologyNode[], plans: VisualPlan[]) {
  return adjacentFloorPairs(nodes, new Map(plans.map((plan) => [plan.id, plan]))).map(inferredEdge);
}

type DrawnStair = {
  node: TopologyNode;
  plan: VisualPlan;
  bounds: PlanBounds;
  fit: ReturnType<typeof fitCalibration>;
};

type DrawingDoor = ReturnType<typeof pilotEvidence>[number]['drawnDoors'][number];

function landingAtDrawnDoor(
  floor: FloorGraph,
  door: DrawingDoor,
  existing: TopologyNode[],
): TopologyNode | undefined {
  const { plan } = floor;
  const places = floor.places.filter((p) => p.kind === 'stairs' && p.label === door.room);
  if (
    places.length !== 1 ||
    existing.some(
      (n) =>
        n.planId === plan.id && n.kind === 'stair-landing' && n.label.split(' · ')[0] === door.room,
    )
  )
    return;
  const cells = new Set(
    places[0].doors
      .filter(([x, y]) => x === door.point.x && y === door.point.y)
      .flatMap(([, , cell]) => (cell === null ? [] : [cell + floor.offset])),
  );
  if (cells.size !== 1) return;
  const [cell] = cells;
  if (!places[0].cells.includes(cell)) return;
  const note = `Door of ${door.room} adjoining ${door.adjoiningLabel} on the original floor plan.`;
  return {
    id: stableUuid(
      `source-stair:${plan.id}:${plan.sourceSha256}:${door.room}:${door.point.x},${door.point.y}:${cell - floor.offset}`,
    ),
    planId: plan.id,
    sourceSha256: plan.sourceSha256,
    version: 1,
    kind: 'stair-landing',
    label: `${door.room} · entrance from ${door.adjoiningLabel}`,
    point: floor.point(cell),
    notes: note,
    evidence: { basis: 'plan', note, observedOn: null },
    createdAt: generatedAt,
    updatedAt: generatedAt,
    review: null,
    reviewHistory: [],
  };
}

function drawnStairLandings(plans: VisualPlan[], existing: TopologyNode[]): DrawnStair[] {
  const included = new Map(plans.map((plan) => [plan.id, plan.sourceSha256]));
  const result: DrawnStair[] = [];
  for (const page of pilotEvidence()) {
    const { plan } = page;
    if (included.get(plan.id) !== plan.sourceSha256) continue;
    const marks = page.drawnDoors.filter((door) => door.stairwellBounds);
    if (!marks.length) continue;
    const alignment = locationCatalogue().floors.find(
      (f) => f.planId === plan.id && f.sourceSha256 === plan.sourceSha256,
    );
    if (alignment?.status !== 'approximate') continue;
    const fit = fitCalibration(alignment.controls, plan.width, plan.height);
    const floor = floorGraphs().byId.get(plan.id)!;
    for (const door of marks) {
      const node = landingAtDrawnDoor(floor, door, existing);
      if (node) result.push({ node, plan, bounds: door.stairwellBounds!, fit });
    }
  }
  return result;
}

/** Compare enclosures in the other sheet's coordinate system, independently of any device GPS. */
function containsOtherStair(enclosure: DrawnStair, other: DrawnStair) {
  const [l, t, r, b] = other.bounds;
  const point = enclosure.fit.project(other.fit.unproject({ x: (l + r) / 2, y: (t + b) / 2 }));
  const [left, top, right, bottom] = enclosure.bounds;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

export function visitorTransferNetwork(existing: TopologyNode[], plans: VisualPlan[]) {
  const stairs = drawnStairLandings(plans, existing);
  function counterparts(stair: DrawnStair, nextFloor: number) {
    const suffix = stairSuffix(stair.node);
    return stairs.filter(
      (other) =>
        other.plan.building === stair.plan.building &&
        Number(other.plan.floor) === nextFloor &&
        suffix !== undefined &&
        stairSuffix(other.node) === suffix &&
        containsOtherStair(stair, other) &&
        containsOtherStair(other, stair),
    );
  }
  const edges = inferSameBuildingTransfers(existing, plans);
  for (const stair of stairs) {
    const floor = Number(stair.plan.floor);
    const above = counterparts(stair, floor + 1);
    // Reject ties on either sheet before creating an edge.
    if (above.length === 1 && counterparts(above[0], floor).length === 1)
      edges.push(inferredEdge([stair.node, above[0].node]));
  }
  return {
    landings: stairs.map((s) => s.node),
    edges,
  };
}
