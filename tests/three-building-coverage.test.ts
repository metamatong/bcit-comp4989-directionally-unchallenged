/** Verify every reported room against the same directed network used for visitor journeys. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  buildingCoverage,
  coverageCsv,
  publishedCoverageStore,
} from '../scripts/report-building-coverage';

it('reproduces the directional inventory and keeps excluded spaces out of both endpoint sets', () => {
  const report = buildingCoverage('--network', publishedCoverageStore());
  const published = readFileSync(
    new URL('../docs/three-building-coverage.csv', import.meta.url),
    'utf8',
  );
  expect(coverageCsv(report, true)).toBe(published);
  expect(Object.keys(report.floors)).toHaveLength(12);
  for (const floor of Object.values(report.floors)) {
    expect(floor.roundTrip).toBeGreaterThan(0);
    expect(floor.mappedRoundTrip + floor.sharedRoundTrip + floor.vicinityRoundTrip).toBe(
      floor.roundTrip,
    );
    expect(floor.roundTrip + floor.remaining).toBe(floor.visitorPlaces);
    expect(floor.visitorPlaces + floor.staffOnly + floor.nonWalking).toBe(floor.places);
  }
  const record = (planId: string, label: string) =>
    report.records.find((r) => r.planId === planId && r.label === label);
  expect(record('SW3-F1-p1', '1750')).toMatchObject({
    originAccess: 'mapped',
    arrivalAccess: 'mapped',
  });
  expect(record('SW3-F1-p1', '1710')).toMatchObject({ arrivalAccess: 'mapped' });
  expect(record('SW1-F2-p1', '2410')).toMatchObject({
    originAccess: 'shared',
    arrivalAccess: 'shared',
  });
  for (const label of ['1494', '1498', '1586']) {
    expect(record('SW1-F1-p1', label)).toMatchObject({
      excluded: 'staff-only',
      originAccess: 'excluded',
      arrivalAccess: 'excluded',
    });
  }
  expect(record('SE12-F2-p1', 'M208')?.excluded).toBe('non-walking');
  expect(record('SW1-F2-p1', 'R240')?.excluded).toBe('non-walking');
  expect(record('SE12-F2-p1', '0000')).toBeUndefined();
});

it('keeps each newly confirmed crossing bidirectional and tied to the marked sheets', () => {
  const { read, candidates } = publishedCoverageStore();
  const graph = read();
  const ids = [
    'se12-f1-f2-s100-s200',
    'sw3-f1-f2-s160-s260',
    'se12-f1-s100-to-102z-exterior',
    'se12-f2-s200-to-201v-exterior',
    'se12-f2-court-to-203y-exterior',
  ];
  for (const id of ids) {
    const definition = candidates.find((c) => c.id === id)!;
    const answer = graph.candidateAnswers.find((a) => a.candidateId === id && a.bindings)!;
    expect(answer).toMatchObject({ direction: 'both', answer: 'true' });
    const edge = graph.edges.find((e) => e.id === answer.bindings!.edgeId)!;
    expect(edge).toMatchObject({ kind: definition.kind, direction: 'both', distanceMeters: null });
    for (const [nodeId, end] of [
      [edge.fromNodeId, definition.from],
      [edge.toNodeId, definition.to],
    ] as const) {
      expect(graph.nodes.find((n) => n.id === nodeId)).toMatchObject({
        planId: end.planId,
        point: end.point,
        sourceSha256: end.sourceSha256,
      });
    }
  }
});
