/** Verify that geometry integrity rejects byte changes, including newline conversion. */
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { getVisualPlan, planGeometrySummary } from '../server/visual-data';

const modifiedRead = vi.hoisted(() => ({ file: '', kind: '' }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    readFileSync: (...args: Parameters<typeof readFileSync>) => {
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
