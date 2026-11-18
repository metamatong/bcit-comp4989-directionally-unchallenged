/** Verify that geometry integrity rejects byte changes, including newline conversion. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  getVisualPlan,
  planGeometrySummary,
  planDrawingSegments,
  preparedGeometryPath,
  readPreparedGeometry,
  visualPlans,
} from '../server/visual-data';

const modifiedRead = vi.hoisted(() => ({ file: '', kind: '', prepared: null as Buffer | null }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    readFileSync: (...args: Parameters<typeof readFileSync>) => {
      if (
        modifiedRead.prepared &&
        String(args[0]).replaceAll('\\', '/').endsWith(preparedGeometryPath)
      )
        return modifiedRead.prepared;
      const bytes = original.readFileSync(...args);
      if (String(args[0]).replaceAll('\\', '/').endsWith(modifiedRead.file) && modifiedRead.file) {
        const text = bytes.toString();
        return Buffer.from(
          modifiedRead.kind === 'crlf' ? text.replaceAll('\n', '\r\n') : `${text} `,
        );
      }
      return bytes;
    },
  };
});

it.each(['crlf', 'content'])('rejects %s changes before using source geometry', (kind) => {
  const plan = getVisualPlan('SE12-F3-p1');
  modifiedRead.file = plan.geometry.file;
  modifiedRead.kind = kind;
  try {
    expect(() => planGeometrySummary(plan)).toThrow('A floor-plan asset changed');
  } finally {
    modifiedRead.file = '';
  }
});

it('loads restored geometry with the original source provenance and complete labels', () => {
  const plan = getVisualPlan('SE12-F3-p1');
  const geometry = planGeometrySummary(plan);
  expect(geometry.sourceRef).toBe(plan.sourceRef);
  expect(geometry.labels).toHaveLength(285);
  expect(geometry.labels.some((label) => label.text === '302')).toBe(true);
});

it('binds all hosted summaries and labels to their source bytes and detects missing or damaged data', () => {
  const entries = visualPlans.map((plan) => ({
    sourceSha256: plan.sourceSha256,
    geometrySha256: plan.geometry.sha256,
    summary: planGeometrySummary(plan),
    drawingSegments: planDrawingSegments(plan),
  }));
  function prepare() {
    modifiedRead.prepared = Buffer.from(JSON.stringify(entries));
    return createHash('sha256').update(modifiedRead.prepared).digest('hex');
  }
  try {
    const digest = prepare();
    const summaries = readPreparedGeometry(digest);
    expect(summaries.size).toBe(89);
    expect(
      [...summaries.values()].reduce((count, summary) => count + summary.labels.length, 0),
    ).toBe(5463);
    expect(
      [...summaries.values()].every(
        (summary) => summary.drawingSegments.length === summary.totalLongSegments,
      ),
    ).toBe(true);
    const strokes = entries[0].drawingSegments;
    entries[0].drawingSegments = [];
    expect(() => readPreparedGeometry(prepare())).toThrow('Prepared geometry');
    entries[0].drawingSegments = strokes;
    entries.pop();
    const incomplete = prepare();
    expect(() => readPreparedGeometry(digest)).toThrow('asset changed');
    expect(() => readPreparedGeometry(incomplete)).toThrow('Incomplete prepared geometry');
  } finally {
    modifiedRead.prepared = null;
  }
});
