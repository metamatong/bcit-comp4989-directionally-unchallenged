/** Contracts for source retrieval, independent of a model or a campus visit. */
import { describe, expect, it } from 'vitest';
import { pilotEvidence, centerIn } from '../server/pilot-evidence';
import { reviewedNetwork, validateNetworkExport, outgoingPassages } from '../server/pilot-network';
import { pilotToolDeclarations, runPilotTool } from '../server/pilot-tools';
import { getPilotContext, lookupPilotLabels, pilotCoverage } from '../server/spatial-retrieval';
import { exportPilotNetwork } from '../scripts/export-pilot-network';
import { createHash } from 'node:crypto';

const find = (...labels: string[]) => lookupPilotLabels({ purpose: 'destination', labels });
describe('twelve source pages', () => {
  it('preserves every original observation and covers the previously empty floors', () => {
    const coverage = pilotCoverage();
    expect(coverage).toHaveLength(12);
    expect(coverage.reduce((sum, p) => sum + p.geometryLabels, 0)).toBe(4641);
    for (const building of ['SE12', 'SW3', 'SW1']) {
      expect(
        coverage
          .filter((p) => p.building === building)
          .map((p) => p.floor)
          .sort(),
      ).toEqual(['1', '2', '3', '4']);
    }
    for (const p of coverage) {
      expect(p.planReadLabels).toBeGreaterThanOrEqual(8);
      expect(p.ocrWords).toBeGreaterThan(100);
      expect(p.distinctIdentifierCandidates).toBeGreaterThan(20);
      const whole = getPilotContext({ planId: p.planId, bounds: [0, 0, 1, 1] });
      if (whole.status !== 'source-context') throw new Error(`Missing context for ${p.planId}`);
      expect(whole.observations).toHaveLength(p.geometryLabels + p.planReadLabels + p.ocrWords);
      expect(new Set(whole.observations?.map((o) => o.id)).size).toBe(whole.observations?.length);
    }
  });
  it.each([
    ['SW03 2605', 'SW3-F2-p1', 'classroom'],
    ['SW3 3615', 'SW3-F3-p1', 'classroom'],
    ['SE12 101N', 'SE12-F1-p1', 'meeting'],
    ['SW01-2004', 'SW1-F2-p1', 'classroom'],
    ['sw1 4035', 'SW1-F4-p1', 'classroom'],
  ])('resolves %s to the printed region with original provenance', (query, planId, kind) => {
    const result = find(query);
    expect(result).toMatchObject({ outcome: 'candidate', commonPlanIds: [planId] });
    const page = result.results[0].matches.find((m) => m.planId === planId)!;
    expect(page.sourceUrl).toMatch(/^https:\/\/www\.bcit\.ca\//);
    expect(page.sourceSha256).toHaveLength(64);
    expect(page.occurrences[0]).toMatchObject({ spaceUse: kind, evidenceLevel: 'plan-read' });
    expect(page.checkpointCandidates).toEqual([]);
    const local = getPilotContext({ planId, bounds: page.occurrences[0].bounds });
    if (local.status !== 'source-context') throw new Error(`Missing context for ${planId}`);
    expect(local.relation).toBe('co-located-on-drawing');
    expect(local.observations?.some((o) => o.id === page.occurrences[0].occurrenceId)).toBe(true);
  });
  it('retains conflicting raw OCR at its original box while rejecting it as a destination', () => {
    const result = find('SW01 302');
    expect(result.outcome).toBe('unsupported');
    expect(
      result.results[0].matches
        .flatMap((m) => m.otherEvidence)
        .some((o) => o.text === '302' && o.disposition === 'conflicts-with-plan'),
    ).toBe(true);
    expect(find('SW01 3021').commonPlanIds).toEqual(['SW1-F3-p1']);
    expect(find('SE12 0302').outcome).toBe('unsupported');
    expect(find('SW03 2458')).toMatchObject({
      outcome: 'unsupported',
      commonPlanIds: [],
      nextStep: 'report-no-supported-label',
    });
    expect(
      find('SW03 2008')
        .results[0].matches.flatMap((m) => m.otherEvidence)
        .some((o) => o.context === 'margin'),
    ).toBe(true);
    expect(find('SW03 2008').outcome).toBe('unsupported');
  });
  it('reports overlaps, conflicts, partial evidence and scope errors without selecting a room by prefix', () => {
    expect(find('S300').outcome).toBe('ambiguous');
    expect(find('S300', 'SE12 302').commonPlanIds).toEqual(['SE12-F3-p1']);
    expect(find('SE12 302', 'SW03 2605').outcome).toBe('conflicting');
    expect(find('SW03 2605', 'SW03 2458').outcome).toBe('partial');
    expect(
      lookupPilotLabels({ labels: ['SW03 2605'], building: 'SW01', purpose: 'origin' }).outcome,
    ).toBe('unsupported');
    expect(find('NE01 302').outcome).toBe('unsupported');
    expect(
      lookupPilotLabels({ labels: ['2605'], building: 'SW03', floor: '3', purpose: 'destination' })
        .commonPlanIds,
    ).toEqual([]);
    expect(lookupPilotLabels({ labels: ['SW03 3615'], purpose: 'origin' }).nextStep).toBe(
      'visually-verify-and-confirm-start',
    );
  });
  it('inverts the portrait source rotation and keeps independent optical readings inspectable', () => {
    const page = pilotEvidence().find((p) => p.plan.id === 'SE12-F1-p1')!;
    const reference = page.observations.find(
      (o) => o.text === '104' && o.method === 'plan-transcription',
    )!;
    expect(
      page.observations.some(
        (o) => o.text === '104' && o.rotation === 90 && centerIn(o.bounds, reference.bounds),
      ),
    ).toBe(true);
    const matches = find('SW03 2605').results[0].matches[0].occurrences;
    expect(matches).toHaveLength(1);
    expect(new Set(matches[0].observations.map((o) => o.method))).toEqual(
      new Set(['geometry', 'ocr', 'plan-transcription']),
    );
  });
  it('retrieves additional printed identifiers across all 12 floors, including untranscribed rooms', () => {
    const controls = [
      ['SE12', '1', '103F', '101F'],
      ['SE12', '2', '205B', '206A'],
      ['SE12', '3', '313', '309'],
      ['SE12', '4', '414', '418'],
      ['SW03', '1', '1604', '1611'],
      ['SW03', '2', '2082', '2087'],
      ['SW03', '3', '3085', '3088'],
      ['SW03', '4', '4083', '4092'],
      ['SW01', '1', '1230', '1435'],
      ['SW01', '2', '2005', '2025'],
      ['SW01', '3', '3030', '3047'],
      ['SW01', '4', '4005', '4072'],
    ];
    for (const [building, floor, ...labels] of controls)
      for (const label of labels) {
        const result = find(`${building} ${label}`);
        expect(result.commonPlanIds, `${building} ${label}`).toContain(
          `${building.replace('SW0', 'SW')}-F${floor}-p1`,
        );
      }
  });
  it('exposes validated tool signatures and fails unsupported or malformed requests explicitly', () => {
    expect(pilotToolDeclarations).toHaveLength(4);
    expect(pilotToolDeclarations.every((t) => t.parametersJsonSchema.type === 'object')).toBe(true);
    expect(
      runPilotTool('get_spatial_context', { planId: 'NW1-F1-p1', bounds: [0, 0, 1, 1] }),
    ).toEqual({ status: 'unsupported-plan' });
    expect(() =>
      runPilotTool('get_spatial_context', { planId: 'SE12-F1-p1', bounds: [0.8, 0, 0.2, 1] }),
    ).toThrow();
    expect(() =>
      runPilotTool('resolve_spatial_labels', {
        purpose: 'destination',
        labels: [],
        forceNode: true,
      }),
    ).toThrow();
    expect(() => runPilotTool('guess_door', {})).toThrow('Unknown');
  });
});

describe('reviewed graph revision', () => {
  const data = reviewedNetwork();
  const plans = pilotEvidence().map((p) => p.plan);
  it('keeps source co-location distinct from a verified door and reports SW01 network gaps', () => {
    const region = getPilotContext({ planId: 'SW1-F2-p1', bounds: [0, 0, 1, 1] });
    if (region.status !== 'source-context') throw new Error('missing SW01 plan');
    expect(region.passageReviewQuestions).toMatchObject([
      { status: 'unreviewed', from: { planId: 'SW1-F2-p1' }, to: { planId: 'SW3-F2-p1' } },
    ]);
    expect(outgoingPassages(region.passageReviewQuestions[0].id).status).toBe(
      'unsupported-checkpoint',
    );
    const room = find('SW03 2605').results[0].matches[0];
    expect(room.checkpointCandidates).toEqual([]);
    expect(room.doorHypotheses).toHaveLength(2);
    for (const door of room.doorHypotheses) {
      expect(door).toMatchObject({
        room: '2605',
        adjoiningLabel: '2600',
        basis: 'plan-read-door-symbol',
      });
      expect(outgoingPassages(door.id).status).toBe('unsupported-checkpoint');
    }
    expect(find('SE12 S300').results[0].matches[0].checkpointCandidates[0].kind).toBe(
      'stair-landing',
    );
    expect(
      pilotCoverage()
        .filter((p) => p.building === 'SW1')
        .every((p) => p.reviewedCheckpoints === 0 && p.incidentReviewedPassages === 0),
    ).toBe(true);
    expect(() =>
      validateNetworkExport(
        { ...data, nodes: data.nodes.map((n) => ({ ...n, sourceSha256: '0'.repeat(64) })) },
        plans,
      ),
    ).toThrow('current official source');
    expect(() =>
      validateNetworkExport(
        { ...data, edges: [{ ...data.edges[0], endpointVersions: { from: 999, to: 999 } }] },
        plans,
      ),
    ).toThrow('Stale');
  });
  it('preserves the reviewed five-link continuous journey in both directions', () => {
    const ids = [
      'sw3-se12-floor2-passage',
      'sw3-f2-door-to-lift-corridor',
      'sw3-f2-f3-east-lift',
      'sw3-f3-lift-to-building-link-corridor',
      'sw3-se12-floor3-passage',
    ];
    const path = ids.map((id) => data.edges.find((e) => e.sourceCandidateId === id)!);
    expect(path.map((e) => e.kind)).toEqual([
      'outdoor',
      'corridor',
      'elevator',
      'corridor',
      'building-link',
    ]);
    const start = path[0].toNodeId,
      end = path.at(-1)!.toNodeId;
    for (const reverse of [false, true]) {
      let current = reverse ? end : start;
      for (const edge of reverse ? [...path].reverse() : path) {
        const step = outgoingPassages(current).passages.find((step) => step.id === edge.id);
        expect(step).toBeDefined();
        current = step!.next.id;
      }
      expect(current).toBe(reverse ? start : end);
    }
    expect(data.edges.some((e) => e.sourceCandidateId === 'sw3-se12-floor4-passage')).toBe(false);
    expect(data.elevatorReports).toMatchObject([
      {
        candidateId: 'se12-f2-f3-lift-location',
        answer: 'false',
        from: { planId: 'SE12-F2-p1' },
        to: { planId: 'SE12-F3-p1' },
      },
    ]);
    expect(JSON.stringify(data)).not.toMatch(
      /"reviewer"|"reviewHistory"|"answeredAt"|"notes"|"note"/,
    );
  });
  it('never publishes an unapproved, withdrawn or changed review on re-export', () => {
    const p = data.nodes[0];
    const evidence = {
      basis: 'user-confirmation',
      note: 'Fixture observation for export tests.',
      observedOn: null,
    };
    const subject = {
      id: p.id,
      version: 1,
      evidence,
      planId: p.planId,
      label: 'test',
      kind: 'door',
      point: p.point,
      sourceSha256: p.sourceSha256,
    };
    function canonical(v: unknown): unknown {
      if (Array.isArray(v)) return v.map(canonical);
      if (v && typeof v === 'object')
        return Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, val]) => [k, canonical(val)]),
        );
      return v;
    }
    const approval = {
      status: 'verified',
      recordVersion: 1,
      contentHash: createHash('sha256')
        .update(JSON.stringify(canonical(subject)))
        .digest('hex'),
      evidence,
      reviewer: 'private fixture',
    };
    const record = { ...subject, review: approval, reviewHistory: [approval] };
    const exportOne = (n: unknown) =>
      exportPilotNetwork(
        Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            revision: 4,
            nodes: [n],
            edges: [],
            candidateAnswers: [],
          }),
        ),
      );
    expect(exportOne(record).nodes).toHaveLength(1);
    expect(exportOne({ ...record, label: 'modified' }).nodes).toEqual([]);
    expect(exportOne({ ...record, review: { ...approval, status: 'draft' } }).nodes).toEqual([]);
    expect(JSON.stringify(exportOne(record))).not.toContain('private fixture');
  });
});
