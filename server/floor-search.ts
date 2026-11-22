/** Dijkstra over drawing cells, source doors and live, directed transfer records. */
import { RouteQueue, compareCosts, type RouteCost } from './route-queue';
import { floorGraphs, floorStride } from './floor-graph';
import { stepText, visitorPassages } from './visitor-paths';
import type { TopologyDocument, TopologyNode } from '../src/topology';
import type { MapStop, WalkingStep } from '../src/wayfinding';
import { routeDrawingCrossings } from './route-geometry';
import type { VisualPlan } from '../src/types';

export type SearchStop = { key: number; stop: MapStop; unlinked?: boolean };
export type VisitorMap = {
  plans: VisualPlan[];
  doc: TopologyDocument;
  nodes: TopologyNode[];
  network: ReturnType<typeof visitorPassages>;
};
type Link = { to: number; cost: number; step: WalkingStep };
const asStop = ({ id, planId, label, point }: TopologyNode): MapStop => ({
  id,
  planId,
  label,
  point,
});
function reversed(step: WalkingStep) {
  const plans = [
    floorGraphs().byId.get(step.to.planId)!.plan,
    floorGraphs().byId.get(step.from.planId)!.plan,
  ];
  return {
    ...step,
    from: step.to,
    to: step.from,
    instruction: stepText(step.kind, step.to, step.from, plans),
    path: [...step.path].reverse(),
  };
}
export class FloorSearch {
  private readonly links = new Map<number, Link[]>();
  private readonly thresholds = new Map<string, number>();
  private readonly nodeKeys = new Map<string, SearchStop>();
  private readonly allowedFloors: Set<string>;
  private readonly cuts = new Map<number, { dx: number; dy: number; closed: boolean }[]>();
  private nextKey = -1;
  constructor(map: VisitorMap) {
    this.allowedFloors = new Set(map.plans.map((p) => p.id));
    const protectedDoors = new Set(map.network.doors.values());
    const liveNodes = new Map(map.nodes.map((node) => [node.id, node]));
    for (const trace of map.network.withdrawn) this.restrict(trace.planId, trace.path, true);
    for (const node of map.nodes) {
      const stop = asStop(node),
        key = this.nextKey--;
      this.nodeKeys.set(node.id, { key, stop });
    }
    for (const edge of map.doc.edges) {
      if (!map.network.allowed.has(edge.id)) continue;
      const from = this.nodeKeys.get(edge.fromNodeId),
        to = this.nodeKeys.get(edge.toNodeId);
      if (!from || !to) continue;
      const trace = map.network.traces.get(edge.id);
      const step: WalkingStep = {
        from: from.stop,
        to: to.stop,
        kind: edge.kind,
        path: [],
        instruction: trace?.instruction ?? stepText(edge.kind, from.stop, to.stop, map.plans),
      };
      if (edge.kind === 'corridor') {
        if (!trace) continue;
        step.path = trace.fromId === from.stop.id ? trace.path : [...trace.path].reverse();
        if (routeDrawingCrossings([step], map.plans, trace.doorwayOpenings).length) {
          this.restrict(from.stop.planId, step.path, true);
          continue;
        }
        // A reviewed room door attaches only through its directed trace. Applying that
        // entry/exit rule across the public grid would also make the shared lobby one-way.
        if (
          edge.direction === 'forward' &&
          !protectedDoors.has(from.stop.id) &&
          !protectedDoors.has(to.stop.id)
        )
          this.restrict(from.stop.planId, step.path, false);
      }
      // Cross floors only at a currently approved transfer, in its permitted direction.
      const nodes = [from];
      for (const point of step.path.slice(1, -1)) {
        const key = this.nextKey--;
        nodes.push({ key, stop: { ...from.stop, id: 'bend:' + key, label: 'Corridor', point } });
      }
      nodes.push(to);
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1],
          b = nodes[i],
          part = {
            ...step,
            from: a.stop,
            to: b.stop,
            path: edge.kind === 'corridor' ? [a.stop.point, b.stop.point] : [],
          };
        this.link(a.key, b.key, part, edge.direction === 'both');
      }
      for (const entry of nodes)
        if (!protectedDoors.has(entry.stop.id) && this.allowedFloors.has(entry.stop.planId))
          this.attach(entry, liveNodes.get(entry.stop.id));
    }
  }
  private restrict(planId: string, path: MapStop['point'][], closed: boolean) {
    const floor = floorGraphs().byId.get(planId);
    if (!floor) return;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      const cut = {
        closed,
        dx: (b.x - a.x) * floor.plan.width,
        dy: (b.y - a.y) * floor.plan.height,
      };
      for (const cell of floor.crossSection(a, b)) {
        const rules = this.cuts.get(cell) ?? [];
        rules.push(cut);
        this.cuts.set(cell, rules);
      }
    }
  }
  private permits(from: number, to: number) {
    if (!this.cuts.has(from) && !this.cuts.has(to)) return true;
    const floor = floorGraphs().ordered[Math.floor(from / floorStride)];
    const a = floor.point(from),
      b = floor.point(to);
    const dx = (b.x - a.x) * floor.plan.width,
      dy = (b.y - a.y) * floor.plan.height;
    return [from, to].every(
      (cell) =>
        this.cuts.get(cell)?.every((c) => !c.closed && c.dx * dx + c.dy * dy >= -1e-8) ?? true,
    );
  }
  reviewed(id: string) {
    return this.nodeKeys.get(id);
  }
  /** Inspect the same directed connections as a visitor, confined to selected sheets. */
  reachable(starts: SearchStop[], plans: Set<string>, reverse = false) {
    const links = new Map<number, number[]>();
    for (const [from, edges] of this.links) {
      for (const edge of edges) {
        if (!plans.has(edge.step.from.planId) || !plans.has(edge.step.to.planId)) continue;
        const [a, b] = reverse ? [edge.to, from] : [from, edge.to];
        const group = links.get(a) ?? [];
        group.push(b);
        links.set(a, group);
      }
    }
    const reached = new Set(starts.filter((s) => plans.has(s.stop.planId)).map((s) => s.key));
    const pending = [...reached];
    const add = (id: number) => {
      if (!reached.has(id)) {
        reached.add(id);
        pending.push(id);
      }
    };
    for (let i = 0; i < pending.length; i++) {
      const from = pending[i];
      for (const to of links.get(from) ?? []) add(to);
      if (from < 0) continue;
      const floor = floorGraphs().ordered[Math.floor(from / floorStride)];
      const move = (to: number) => {
        if (reverse ? this.permits(to, from) : this.permits(from, to)) add(to);
      };
      floor.neighbours(from, move);
      for (const p of floor.portals.get(from) ?? []) move(p.cell);
    }
    return reached;
  }
  terminal(planId: string, label: string, cell: number, path: MapStop['point'][]): SearchStop {
    const floor = floorGraphs().byId.get(planId)!;
    const point = path[0];
    // Each physical door and exit combination is a dead end. Interior walks can
    // serve the requested room without creating shortcuts between public corridors.
    const id = floor.thresholdId(point) + ':via:' + cell;
    let key = this.thresholds.get(id);
    const stop = { id, planId, label, point };
    if (key === undefined) {
      key = this.nextKey--;
      this.thresholds.set(id, key);
      const length = path
        .slice(1)
        .reduce(
          (sum, next, i) =>
            sum +
            Math.hypot(
              (next.x - path[i].x) * floor.plan.width,
              (next.y - path[i].y) * floor.plan.height,
            ) /
              2,
          0,
        );
      this.link(
        key,
        cell,
        {
          kind: 'corridor',
          from: stop,
          to: floor.stop(cell, 'Corridor'),
          path,
          instruction: 'Follow the marked approach to the public corridor.',
        },
        true,
        length,
      );
    }
    return { stop, key };
  }
  threshold(planId: string, point: MapStop['point'], label: string): SearchStop {
    const id = floorGraphs().byId.get(planId)!.thresholdId(point);
    let key = this.thresholds.get(id);
    if (key === undefined) {
      key = this.nextKey--;
      this.thresholds.set(id, key);
    }
    return { key, unlinked: true, stop: { id, label, point, planId } };
  }
  private link(from: number, to: number, step: WalkingStep, both: boolean, pathCost?: number) {
    const floor = floorGraphs().byId.get(step.from.planId)!;
    // Weights express drawing-grid travel on a floor and one transfer penalty, never metres or time.
    const cost =
      pathCost ??
      (step.kind === 'corridor'
        ? Math.max(
            0.01,
            Math.hypot(
              ((step.to.point.x - step.from.point.x) * floor.plan.width) / 2,
              ((step.to.point.y - step.from.point.y) * floor.plan.height) / 2,
            ),
          )
        : 1);
    const add = (a: number, b: number, s: WalkingStep) => {
      const list = this.links.get(a) ?? [];
      if (!list.some((l) => l.to === b)) list.push({ to: b, cost, step: s });
      this.links.set(a, list);
    };
    add(from, to, step);
    if (both) add(to, from, reversed(step));
  }
  private attach(entry: SearchStop, node?: TopologyNode) {
    const floor = floorGraphs().byId.get(entry.stop.planId)!;
    const access = floor.approachAt(entry.stop.point, node);
    if (!access) return;
    const from = entry.stop,
      to = floor.stop(access.cell, 'Corridor');
    this.link(
      entry.key,
      access.cell,
      {
        kind: 'corridor',
        from,
        to,
        instruction: 'Follow the marked passage.',
        path: [from.point, ...access.via, to.point],
      },
      true,
    );
  }
  route(origins: SearchStop[], goals: SearchStop[], preferElevators = false) {
    return (
      this.search(origins, goals, preferElevators ? 'stairs' : 'elevator') ??
      this.search(origins, goals)
    );
  }
  private search(origins: SearchStop[], goals: SearchStop[], excluded?: WalkingStep['kind']) {
    const floors = floorGraphs().ordered;
    const end = new Map(goals.map((goal) => [goal.key, goal]));
    const starts = new Map(origins.map((item) => [item.key, item]));
    const queue = new RouteQueue(),
      costs = new Map<number, RouteCost>(),
      parents = new Map<number, { id: number; step?: WalkingStep }>();
    for (const origin of origins) {
      const zero = { transfers: 0, buildingChanges: 0, outdoor: 0, length: 0 };
      queue.push(origin.key, zero);
      costs.set(origin.key, zero);
    }
    for (let next = queue.pop(); next; next = queue.pop()) {
      const { id, cost } = next;
      if (cost !== costs.get(id)) continue;
      const destination = end.get(id);
      if (destination) {
        const path: { from: number; to: number; step?: WalkingStep }[] = [];
        let node = id;
        for (let prior = parents.get(node); prior; prior = parents.get(node)) {
          path.push({ from: prior.id, to: node, step: prior.step });
          node = prior.id;
        }
        const origin = starts.get(node)!;
        return {
          origin: origin.stop,
          destination: destination.stop,
          steps: walkingSteps(path.reverse(), origin.stop, destination.stop),
        };
      }
      function visit(to: number, weight: number, step?: WalkingStep) {
        const transfer = step !== undefined && step.kind !== 'corridor';
        const c: RouteCost = {
          transfers: cost.transfers + Number(transfer),
          buildingChanges:
            cost.buildingChanges +
            Number(
              transfer &&
                floorGraphs().byId.get(step.from.planId)!.plan.building !==
                  floorGraphs().byId.get(step.to.planId)!.plan.building,
            ),
          outdoor: cost.outdoor + Number(step?.kind === 'outdoor'),
          length: cost.length + weight,
        };
        const old = costs.get(to);
        if (old && compareCosts(c, old) >= 0) return;
        costs.set(to, c);
        parents.set(to, { id, step });
        queue.push(to, c);
      }
      for (const link of this.links.get(id) ?? []) {
        if (link.step.kind !== excluded) visit(link.to, link.cost, link.step);
      }
      if (id < 0) continue;
      const floor = floors[Math.floor(id / floorStride)];
      if (!this.allowedFloors.has(floor.plan.id)) continue;
      floor.neighbours(id, (to, weight) => {
        if (this.permits(id, to)) visit(to, weight);
      });
      for (const door of floor.portals.get(id) ?? []) {
        if (!this.permits(id, door.cell)) continue;
        const from = floor.stop(id, 'Doorway'),
          to = floor.stop(door.cell, 'Doorway');
        const path = [from.point, ...door.opening, to.point];
        const length = Math.hypot(
          ((to.point.x - from.point.x) * floor.plan.width) / 2,
          ((to.point.y - from.point.y) * floor.plan.height) / 2,
        );
        visit(door.cell, length, {
          kind: 'corridor',
          from,
          to,
          instruction: 'Go through the marked doorway.',
          path,
        });
      }
    }
    return undefined;
  }
}
function walkingSteps(
  path: { from: number; to: number; step?: WalkingStep }[],
  origin: MapStop,
  destination: MapStop,
) {
  const steps: WalkingStep[] = [];
  for (const { from, to, step } of path) {
    const floor = !step ? floorGraphs().ordered[Math.floor(from / floorStride)] : undefined;
    const leg = step ?? {
      kind: 'corridor' as const,
      from: floor!.stop(from, 'Corridor'),
      to: floor!.stop(to, 'Corridor'),
      instruction: 'Follow the marked corridor.',
      path: [floor!.point(from), floor!.point(to)],
    };
    const prev = steps.at(-1);
    if (
      prev &&
      prev.kind === 'corridor' &&
      leg.kind === 'corridor' &&
      prev.to.planId === leg.from.planId
    ) {
      prev.path.push(...leg.path.slice(1));
      prev.to = leg.to;
    } else steps.push({ ...leg, path: [...leg.path] });
  }
  if (steps.length) {
    steps[0].from = origin;
    steps[steps.length - 1].to = destination;
  }
  for (const step of steps) {
    if (step.kind !== 'corridor') continue;
    const distinct = step.path.filter(
      (p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y,
    );
    step.path = distinct.filter((p, i, points) => {
      if (i === 0 || i === points.length - 1) return true;
      const a = points[i - 1],
        b = points[i + 1];
      const dx = p.x - a.x,
        dy = p.y - a.y,
        ex = b.x - p.x,
        ey = b.y - p.y;
      return Math.abs(dx * ey - dy * ex) > 1e-12 || dx * ex + dy * ey < 0;
    });
  }
  return steps;
}
