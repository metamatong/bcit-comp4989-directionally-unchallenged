/** A source-checked path forest for user-selected interior positions. These are terminal legs only. */
import { z } from 'zod';
import type { PagePoint } from '../src/wayfinding';
const index = z.number().int().nonnegative();
const coord = z.number().min(0).max(1);
const pair = z.tuple([coord, coord]);
export const interiorSchema = z.object({
  runs: z.array(z.tuple([index, index, index, z.number().int()])),
  ports: z.array(z.tuple([index, index, pair, pair, pair])),
});
export class FloorInterior {
  readonly runs: [number, number, number][] = [];
  private readonly parent: Int32Array;
  private readonly doors = new Map<number, PagePoint[]>();
  constructor(
    data: z.infer<typeof interiorSchema>,
    private readonly width: number,
    publicCells: Uint8Array,
  ) {
    this.parent = new Int32Array(publicCells.length);
    for (const [y, left, right, delta] of data.runs) {
      const from = y * width + left,
        to = y * width + right;
      if (
        !delta ||
        right < left ||
        right >= width ||
        from + delta < 0 ||
        to + delta >= this.parent.length ||
        to >= this.parent.length
      )
        throw Error('Invalid interior run.');
      for (let cell = from; cell <= to; cell++) {
        if (publicCells[cell] || this.parent[cell]) throw Error('Overlapping interior access.');
        this.parent[cell] = delta;
      }
      const prior = this.runs.at(-1);
      if (prior && prior[0] === y && prior[2] + 1 === left) prior[2] = right;
      else this.runs.push([y, left, right]);
    }
    for (const [from, to, ...via] of data.ports) {
      if (!this.parent[from] || from + this.parent[from] !== to || this.doors.has(from))
        throw Error('Invalid terminal doorway.');
      this.doors.set(
        from,
        via.map(([x, y]) => ({ x, y })),
      );
    }
    // Validate all chains once. Every marked position must terminate at a public cell.
    const state = new Uint8Array(publicCells);
    for (let start = 0; start < this.parent.length; start++) {
      if (!this.parent[start] || state[start] === 1) continue;
      const chain: number[] = [];
      let cell = start;
      while (!state[cell]) {
        const delta = this.parent[cell],
          next = cell + delta;
        if (!delta || next < 0 || next >= state.length)
          throw Error('Disconnected interior access.');
        if (
          Math.abs(delta) !== width &&
          !(Math.abs(delta) === 1 && Math.floor(cell / width) === Math.floor(next / width)) &&
          !this.doors.has(cell)
        )
          throw Error('A terminal jump needs source doorway geometry.');
        state[cell] = 2;
        chain.push(cell);
        cell = next;
      }
      if (state[cell] !== 1) throw Error('Interior access contains a cycle.');
      for (const done of chain) state[done] = 1;
    }
  }
  walk(start: number, point: (cell: number) => PagePoint) {
    if (!this.parent[start]) return;
    const path: PagePoint[] = [point(start)];
    let cell = start;
    while (this.parent[cell]) {
      const via = this.doors.get(cell);
      if (via) path.push(...via);
      const delta = this.parent[cell];
      cell += delta;
      if (via || delta !== this.parent[cell] || this.doors.has(cell)) path.push(point(cell));
    }
    return { cell, path };
  }
}
