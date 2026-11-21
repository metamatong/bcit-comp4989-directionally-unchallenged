/** Infer same-building floor transfers from source-backed stair/elevator landings. */
import { createHash } from 'node:crypto';
import type { TopologyEdge, TopologyNode } from '../src/topology';
import type { VisualPlan } from '../src/types';
import { floorGraphs } from './floor-graph';

const transferBuildings = new Set(['SE12', 'SW3', 'SW1']);
const transferKinds = new Set(['stair-landing', 'elevator-stop']);
const now = '2026-01-01T00:00:00.000Z';

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
    if (!plan || !transferBuildings.has(plan.building) || !transferKinds.has(node.kind)) continue;
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

/** Build ephemeral links; no human approval record is required for same-building transfers. */
export function inferSameBuildingTransfers(nodes: TopologyNode[], plans: VisualPlan[]) {
  const planIndex = new Map(plans.map((plan) => [plan.id, plan]));
  return adjacentFloorPairs(nodes, planIndex).map(([from, to]): TopologyEdge => {
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
      reviewedAt: now,
      recordVersion: 1,
      contentHash,
      evidence,
    };
    return {
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
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
  });
}
