/** Dijkstra over drawing cells, source doors and live, directed transfer records. */
import { floorGraphs, floorStride, pointKey } from './floor-graph';
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
  const target = floorGraphs().byId.get(step.from.planId)!.plan;
  return {
    ...step,
    from: step.to,
    to: step.from,
    instruction: stepText(step.kind, step.from, [target]),
    path: [...step.path].reverse(),
  };
}
class Queue {
  private items: { id: number; cost: number }[] = [];
  push(id: number, cost: number) {
    const a = this.items;
    let i = a.length;
    a.push({ id, cost });
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].cost <= cost) break;
      a[i] = a[parent];
      i = parent;
    }
    a[i] = { id, cost };
  }
  pop() {
    const a = this.items,
      first = a[0],
      last = a.pop();
    if (last && a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let n = i * 2 + 1;
        if (n + 1 < a.length && a[n + 1].cost < a[n].cost) n++;
        if (a[n].cost >= last.cost) break;
        a[i] = a[n];
        i = n;
      }
      a[i] = last;
    }
    return first;
  }
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
        instruction: trace?.instruction ?? stepText(edge.kind, to.stop, map.plans),
      };
      if (edge.kind === 'corridor') {
        if (!trace) continue;
        step.path = trace.fromId === from.stop.id ? trace.path : [...trace.path].reverse();
        if (routeDrawingCrossings([step], map.plans, trace.doorwayOpenings).length) {
          this.restrict(from.stop.planId, step.path, true);
          continue;
        }
        if (edge.direction === 'forward') this.restrict(from.stop.planId, step.path, false);
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
          this.attach(entry);
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
  threshold(planId: string, point: MapStop['point'], label: string): SearchStop {
    const id = floorGraphs().byId.get(planId)!.thresholdId(point);
    let key = this.thresholds.get(id);
    if (key === undefined) {
      key = this.nextKey--;
      this.thresholds.set(id, key);
    }
    return { key, unlinked: true, stop: { id, label, point, planId } };
  }
  private link(from: number, to: number, step: WalkingStep, both: boolean) {
    const floor = floorGraphs().byId.get(step.from.planId)!;
    // Weights express drawing-grid travel on a floor and one transfer penalty, never metres or time.
    const cost =
      step.kind === 'corridor'
        ? Math.max(
            0.01,
            Math.hypot(
              ((step.to.point.x - step.from.point.x) * floor.plan.width) / 2,
              ((step.to.point.y - step.from.point.y) * floor.plan.height) / 2,
            ),
          )
        : 1;
    const add = (a: number, b: number, s: WalkingStep) => {
      const list = this.links.get(a) ?? [];
      if (!list.some((l) => l.to === b)) list.push({ to: b, cost, step: s });
      this.links.set(a, list);
    };
    add(from, to, step);
    if (both) add(to, from, reversed(step));
  }
  private attach(entry: SearchStop) {
    const floor = floorGraphs().byId.get(entry.stop.planId)!,
      cell = floor.containingCell(entry.stop.point) ?? floor.ties.get(pointKey(entry.stop.point));
    if (cell === undefined) return;
    const from = floor.stop(cell, 'Corridor'),
      to = entry.stop;
    this.link(
      cell,
      entry.key,
      {
        kind: 'corridor',
        from,
        to,
        instruction: 'Follow the marked passage.',
        path: [from.point, to.point],
      },
      true,
    );
  }
  route(origins: SearchStop[], goals: SearchStop[]) {
    const floors = floorGraphs().ordered;
    const end = new Map(goals.map((goal) => [goal.key, goal]));
    const starts = new Map(origins.map((item) => [item.key, item]));
    const queue = new Queue(),
      costs = new Map<number, number>(),
      parents = new Map<number, { id: number; step?: WalkingStep }>();
    for (const origin of origins) {
      queue.push(origin.key, 0);
      costs.set(origin.key, 0);
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
        const c = cost + weight;
        if (c >= (costs.get(to) ?? Infinity)) return;
        costs.set(to, c);
        parents.set(to, { id, step });
        queue.push(to, c);
      }
      for (const link of this.links.get(id) ?? []) visit(link.to, link.cost, link.step);
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
