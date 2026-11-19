/** Dijkstra priorities for approved transfers, with drawing length as the final tie-breaker. */
export type RouteCost = {
  transfers: number;
  buildingChanges: number;
  outdoor: number;
  length: number;
};
export function compareCosts(a: RouteCost, b: RouteCost) {
  return (
    a.transfers - b.transfers ||
    a.buildingChanges - b.buildingChanges ||
    a.outdoor - b.outdoor ||
    a.length - b.length
  );
}
export class RouteQueue {
  private items: { id: number; cost: RouteCost }[] = [];
  push(id: number, cost: RouteCost) {
    const a = this.items;
    let i = a.length;
    a.push({ id, cost });
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareCosts(a[parent].cost, cost) <= 0) break;
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
        if (n + 1 < a.length && compareCosts(a[n + 1].cost, a[n].cost) < 0) n++;
        if (compareCosts(a[n].cost, last.cost) >= 0) break;
        a[i] = a[n];
        i = n;
      }
      a[i] = last;
    }
    return first;
  }
}
