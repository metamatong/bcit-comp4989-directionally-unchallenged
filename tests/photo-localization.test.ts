import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  analyzeCampusPhoto,
  confirmCampusRegion,
  comparisonSchema,
} from '../server/photo-localization';
import { readPhotoEvidence, requirePhotoEvidence } from '../server/photo-evidence';
import {
  photoEvidenceRequestSchema,
  photoRequestSchema,
  validatePhotoBundle,
} from '../server/photo-media';
import { newSession } from '../server/session';
import { getVisualPlan, planAtlases, planGeometrySummary } from '../server/visual-data';
import { CampusLocationResults } from '../src/components/CampusLocationResults';
import { groundPhotoRegion } from '../server/photo-grounding';
import { retrieveRoomLabels } from '../server/room-labels';
import type { PlanBounds } from '../src/types';
import type { GenerationOptions, ModelContent, ModelPart, Provider } from '../server/provider';
import {
  photoInput,
  comparisonInput,
  fixtureImage,
  labelReading,
  shortlist,
  comparison,
} from './photo-fixtures';

function fixture(turns: ModelPart[][]) {
  const captures: { contents: ModelContent[]; options?: GenerationOptions }[] = [];
  const provider: Provider = {
    calls: 0,
    async generate(contents, _tools, _signal, onAttempt, options) {
      captures.push({ contents, options });
      onAttempt?.();
      return turns[this.calls++] ?? [];
    },
  };
  return { provider, captures };
}

describe('separate photo evidence and source-grounded localization stages (mocked Gemini)', () => {
  const screenshotBox: PlanBounds = [0.08, 0.3, 0.3, 0.48];
  const door302: PlanBounds = [0.145, 0.574, 0.158, 0.598];
  const door320: PlanBounds = [0.549, 0.572, 0.562, 0.596];
  const plan = getVisualPlan('SE12-F3-p1');
  const match320 = { observedLabel: '320', planLabel: '320' };
  const match302 = { observedLabel: '302', planLabel: '302' };
  async function compareRoom(
    reading: string,
    bounds: PlanBounds,
    summary: string,
    claimed = [{ observedLabel: reading, planLabel: reading }],
    printedOnly = false,
  ) {
    const input = photoInput({ scope: 'wayfinding-pilot' });
    const response = comparison({ summary }, plan.id, bounds);
    const args = response[0].functionCall!.args as {
      candidates: {
        labelMatches: typeof claimed;
        matches: { kind: string; photoFeature: string; planFeature: string }[];
      }[];
    };
    args.candidates[0].labelMatches = claimed;
    if (printedOnly)
      args.candidates[0].matches = [
        {
          kind: 'printed-label',
          photoFeature: `The sign reads ${reading}`,
          planFeature: `The print reads ${reading}`,
        },
      ];
    const { provider } = fixture([labelReading(reading), response]),
      session = newSession();
    const record = await readPhotoEvidence(session, input, provider);
    const result = await analyzeCampusPhoto(
      session,
      comparisonInput(input, record.evidence.id),
      provider,
      record,
    );
    const markup = renderToStaticMarkup(
      createElement(CampusLocationResults, {
        analysis: result,
        plans: [plan],
        onConfirm: () => {},
        busy: false,
      }),
    );
    return { result, session, markup };
  }
  it.each([
    [
      'box spanning unrelated rooms',
      [0.05, 0.3, 0.72, 0.64],
      'The adjoining doorway matches the photo.',
      [match302],
    ],
    [
      'box from the screenshot',
      screenshotBox,
      'The adjoining doorway matches the photo.',
      [match302],
    ],
    [
      'transposed room in prose',
      door302,
      'The photo matches the doorway outside room 320.',
      [match302],
    ],
    [
      'invented corridor in prose',
      door302,
      'The photo matches corridor 800C outside room 302.',
      [match302],
    ],
    [
      'a different room in structured evidence',
      screenshotBox,
      'A doorway and corridor.',
      [match320],
    ],
  ] as const)(
    'withholds the position and marks the printed 302 when the comparison returns a %s',
    async (_name, box, summary, claims) => {
      const { result, session, markup } = await compareRoom('302', [...box], summary, [...claims]);
      expect(result).toMatchObject({
        outcome: 'insufficient_evidence',
        candidates: [],
        referenceLabels: [
          {
            label: '302',
            planId: plan.id,
            sourceSha256: plan.sourceSha256,
            bounds: [0.1307353, 0.5386364, 0.1398529, 0.5462121],
          },
        ],
      });
      expect(result.labelRetrieval).toMatchObject({
        clearLabels: ['302'],
        exactMatchPlanIds: [plan.id],
      });
      expect(markup).toContain('Printed plan label 302');
      expect(markup).not.toMatch(
        /outside room 320|800C|class="estimated-region"|Confirm this possible region/,
      );
      expect(() => confirmCampusRegion(session, randomUUID())).toThrow('current photo comparison');
    },
  );
  it('retains the confirmed 302 reading and accepts a visual area at its source doorway', async () => {
    const { result } = await compareRoom('302', door302, 'A doorway matches room 302.');
    expect(result).toMatchObject({
      outcome: 'candidates',
      candidates: [{ planId: plan.id, bounds: door302, sourceLabels: [{ label: '302' }] }],
    });
  });
  it('shows the printed room as a reference when only the sign matches', async () => {
    const { result, markup } = await compareRoom(
      '320',
      door320,
      'The photo contains 320.',
      [match320],
      true,
    );
    expect(result.outcome).toBe('insufficient_evidence');
    expect(markup).toContain('Printed plan label 320');
    expect(markup).not.toContain('Confirm this possible region');
  });
  it('keeps the source position of an unambiguous label when visual comparison abstains entirely', async () => {
    const input = photoInput({ buildingHint: 'SE12' }),
      session = newSession();
    const { provider } = fixture([
      labelReading('320'),
      comparison({ outcome: 'insufficient_evidence', candidates: [], summary: 'Maybe room 302.' }),
    ]);
    const record = await readPhotoEvidence(session, input, provider);
    const result = await analyzeCampusPhoto(
      session,
      comparisonInput(input, record.evidence.id),
      provider,
      record,
    );
    expect(result).toMatchObject({
      outcome: 'insufficient_evidence',
      candidates: [],
      referenceLabels: [{ label: '320', planId: 'SE12-F3-p1' }],
    });
    expect(result.summary).not.toContain('302');
  });
  it('keeps the visually selected doorway box distinct from the room text printed away from the door', async () => {
    const { result, markup } = await compareRoom('320', door320, 'A doorway matches room 320.');
    expect(result).toMatchObject({
      outcome: 'candidates',
      candidates: [{ bounds: door320, sourceLabels: [{ label: '320' }] }],
    });
    expect(markup).toContain('class="estimated-region"');
    expect(markup).toContain('Printed plan label 320');
  });
  it('requires every clear corroborated sign and preserves ambiguity between distinct printed occurrences', () => {
    const candidate = {
      planId: plan.id,
      bounds: door320,
      labelMatches: [match320],
      matches: [
        {
          photoFeature: 'A door',
          planFeature: 'Door at the corridor',
          kind: 'architecture' as const,
        },
      ],
      limitations: [],
    };
    const retrieval = retrieveRoomLabels(
      ['320', '302'].map((text) => ({ text, clarity: 'clear', viewId: 'full' })),
      new Set([plan.id]),
    );
    expect(groundPhotoRegion(plan, candidate, retrieval, 'Doorway').conflict).toBe(true);
    const original = retrieval.matches.find(
      (m) => m.text === '320' && m.method === 'manual-plan-transcription',
    )!;
    // Simulate a second independent printing of the same room number on this page.
    const two = {
      ...retrieval,
      clearLabels: ['320'],
      matches: [
        original,
        { ...original, evidenceId: 'other-print', bbox: [146, 410, 158, 416] as PlanBounds },
      ],
    };
    const both = groundPhotoRegion(
      plan,
      { ...candidate, bounds: [0.1, 0.49, 0.62, 0.55] },
      two,
      'Doorway',
    );
    expect(both.conflict).toBe(true);
    expect(both.references).toHaveLength(2);
    expect(groundPhotoRegion(plan, candidate, two, 'Doorway').conflict).toBe(true);
    expect(
      groundPhotoRegion(plan, { ...candidate, bounds: [0.56, 0.5, 0.59, 0.55] }, two, 'Doorway')
        .conflict,
    ).toBe(false);
  });
  it('keeps alternative floors in the visual shortlist when only automatic plan OCR matches', async () => {
    const session = newSession(),
      input = photoInput({ buildingHint: 'SW03' });
    const response = comparison({}, 'SW3-F2-p1');
    const payload = response[0].functionCall!.args as { candidates: { labelMatches: unknown[] }[] };
    payload.candidates[0].labelMatches = [];
    const { provider, captures } = fixture([
      labelReading('3083'),
      shortlist(['SW3-F2-p1']),
      response,
    ]);
    const receipt = await readPhotoEvidence(session, input, provider);
    const result = await analyzeCampusPhoto(
      session,
      comparisonInput(input, receipt.evidence.id),
      provider,
      receipt,
    );
    expect(result.labelRetrieval.exactMatchPlanIds).toEqual(['SW3-F3-p1']);
    expect(result.candidates[0]).toMatchObject({
      planId: 'SW3-F2-p1',
      labelMatches: [],
      verification: 'unverified-ai-hypothesis',
    });
    expect(captures[1].options?.forceTool).toBe('select_floor_plans');
    expect(result.atlasPlanCount).toBe(4);
    expect(session.campusLocation).toBeNull();
  });
  it('uses the pilot RAG evidence for SW03 3615 only after the independent image reading', async () => {
    const input = photoInput({ buildingHint: 'SW03' });
    const output = comparison({}, 'SW3-F3-p1', [0.5, 0.57, 0.55, 0.63]);
    const payload = output[0].functionCall!.args as {
      candidates: { labelMatches: { observedLabel: string; planLabel: string }[] }[];
    };
    payload.candidates[0].labelMatches = [{ observedLabel: '3615', planLabel: '3615' }];
    const { provider, captures } = fixture([labelReading('3615'), output]);
    const session = newSession();
    const receipt = await readPhotoEvidence(session, input, provider);
    expect(JSON.stringify(captures[0].contents)).not.toContain('SW3-F3');
    const result = await analyzeCampusPhoto(
      session,
      comparisonInput(input, receipt.evidence.id),
      provider,
      receipt,
    );
    expect(result.candidates[0]).toMatchObject({
      planId: 'SW3-F3-p1',
      verification: 'unverified-ai-hypothesis',
    });
    expect(JSON.stringify(captures[1].contents)).toContain('manual-plan-transcription');
    expect(session.campusLocation).toBeNull();
  });
  it('reads the photo without plan hints, then retrieves all exact labels and compares SE12 floor 3 directly', async () => {
    const session = newSession();
    const input = photoInput();
    const { provider, captures } = fixture([labelReading(), comparison()]);
    const record = await readPhotoEvidence(session, input, provider);
    expect(session.campusAnalysis).toBeNull();
    expect(session.campusLocation).toBeNull();
    expect(captures[0].options?.forceTool).toBe('read_photo_labels');
    expect(captures[0].contents[0].parts.filter((part) => part.inlineData)).toHaveLength(5);
    expect(JSON.stringify(captures[0].contents)).not.toContain('SE12-F3');
    expect(JSON.stringify(captures[0].contents)).not.toContain('EXTRACTED GEOMETRY');

    const result = await analyzeCampusPhoto(
      session,
      comparisonInput(input, record.evidence.id),
      provider,
      record,
    );
    expect(provider.calls).toBe(2);
    expect(session.providerCalls).toBe(2);
    expect(captures[1].options?.forceTool).toBe('propose_campus_locations');
    expect(captures[1].contents[0].parts.filter((part) => part.inlineData)).toHaveLength(11);
    expect(
      captures[1].contents[0].parts.filter((part) => part.inlineData?.data === fixtureImage.data),
    ).toHaveLength(5);
    const detailText = captures[1].contents[0].parts
      .flatMap((part) => (part.text ? [part.text] : []))
      .join('\n');
    expect(detailText).toContain('EXTRACTED GEOMETRY');
    expect(detailText).toContain('SE12-F3#page=1');
    expect(detailText).toContain('"text":"302"');
    expect(detailText).not.toContain('SW1-F3-p1');
    expect(result.labelRetrieval.exactMatchPlanIds).toEqual(['SE12-F3-p1']);
    expect(result.labelRetrieval.indexedLabels).toBeGreaterThan(5463);
    expect(result.atlasPlanCount).toBe(0);
    expect(result.candidates[0].floor).toBe('3');
    expect(result.candidates[0].labelMatches).toEqual([{ observedLabel: '302', planLabel: '302' }]);
    expect(session.photoEvidence).toBeNull();
    expect(session.campusLocation).toBeNull();
    expect(JSON.stringify(session)).not.toContain(input.image.data);
    expect(session.activity.map((entry) => entry.tool)).toEqual([
      'read_photo_labels',
      'retrieve_room_labels',
      'inspect_floor_plans',
      'photo_comparison_complete',
    ]);
    for (const capture of captures) expect(capture.options?.thinkingLevel).toBe('low');
  });
  it('can confirm only the proposed source-linked region', async () => {
    const session = newSession(),
      input = photoInput();
    const { provider } = fixture([labelReading(), comparison()]);
    const record = await readPhotoEvidence(session, input, provider);
    await analyzeCampusPhoto(session, comparisonInput(input, record.evidence.id), provider, record);
    confirmCampusRegion(session, session.campusAnalysis!.candidates[0].id);
    expect(session.campusLocation?.planId).toBe('SE12-F3-p1');
    expect(session).not.toHaveProperty('route');
    expect(() => confirmCampusRegion(session, randomUUID())).toThrow('current photo comparison');
  });
  it('rejects SW1 as a source when the clear room 302 reading retrieved only SE12', async () => {
    const session = newSession(),
      input = photoInput();
    const { provider } = fixture([labelReading(), comparison({}, 'SW1-F3-p1')]);
    const record = await readPhotoEvidence(session, input, provider);
    await expect(
      analyzeCampusPhoto(session, comparisonInput(input, record.evidence.id), provider, record),
    ).rejects.toThrow('invalid source IDs');
    expect(session.campusAnalysis).toBeNull();
    expect(session.activity.map((entry) => entry.tool)).toEqual([
      'read_photo_labels',
      'photo_comparison_stopped',
    ]);
  });
  it.each(['3021', '0302', '302A'])(
    'rejects a model claim that 302 matches %s',
    async (wrongLabel) => {
      const response = comparison();
      (
        response[0].functionCall!.args as { candidates: { labelMatches: unknown[] }[] }
      ).candidates[0].labelMatches = [{ observedLabel: '302', planLabel: wrongLabel }];
      const session = newSession(),
        input = photoInput();
      const { provider } = fixture([labelReading(), response]);
      const record = await readPhotoEvidence(session, input, provider);
      const result = await analyzeCampusPhoto(
        session,
        comparisonInput(input, record.evidence.id),
        provider,
        record,
      );
      expect(result).toMatchObject({
        outcome: 'insufficient_evidence',
        candidates: [],
        referenceLabels: [{ label: '302' }],
      });
      expect(session.campusLocation).toBeNull();
    },
  );
  it('requires a verified exact label in label-guided results, while allowing visual abstention', async () => {
    const response = comparison();
    (
      response[0].functionCall!.args as { candidates: { labelMatches: unknown[] }[] }
    ).candidates[0].labelMatches = [];
    const session = newSession(),
      input = photoInput();
    const { provider } = fixture([labelReading(), response]);
    const record = await readPhotoEvidence(session, input, provider);
    const request = comparisonInput(input, record.evidence.id);
    const result = await analyzeCampusPhoto(session, request, provider, record);
    expect(result.outcome).toBe('insufficient_evidence');
    expect(result.candidates).toEqual([]);
  });
  it('still performs photo/crop visual shortlisting when there is no readable label', async () => {
    const response = comparison();
    (
      response[0].functionCall!.args as { candidates: { labelMatches: unknown[] }[] }
    ).candidates[0].labelMatches = [];
    const { provider, captures } = fixture([labelReading(null), shortlist(), response]);
    const session = newSession(),
      input = photoInput();
    const record = await readPhotoEvidence(session, input, provider);
    const result = await analyzeCampusPhoto(
      session,
      comparisonInput(input, record.evidence.id),
      provider,
      record,
    );
    expect(provider.calls).toBe(3);
    expect(captures[1].options?.forceTool).toBe('select_floor_plans');
    expect(captures[1].contents[0].parts.filter((part) => part.inlineData)).toHaveLength(
      planAtlases.length + 5,
    );
    expect(result.atlasPlanCount).toBe(89);
    expect(result.labelRetrieval.clearLabels).toEqual([]);
  });
  it('does not turn uncertain or unknown labels into a forced building match', async () => {
    for (const [reading, clarity] of [
      ['302', 'uncertain'],
      ['99999', 'clear'],
    ] as const) {
      const session = newSession(),
        input = photoInput();
      const { provider, captures } = fixture([labelReading(reading, clarity), shortlist([])]);
      const record = await readPhotoEvidence(session, input, provider);
      const result = await analyzeCampusPhoto(
        session,
        comparisonInput(input, record.evidence.id),
        provider,
        record,
      );
      expect(captures[1].options?.forceTool).toBe('select_floor_plans');
      expect(result.candidates).toEqual([]);
      expect(result.atlasPlanCount).toBe(89);
    }
  });
  it.each(['demo-layout-v1', '../../.env', 'NW999-F1-p1'])(
    'rejects an unsupplied visual-shortlist ID: %s',
    async (id) => {
      const session = newSession(),
        input = photoInput();
      const { provider } = fixture([labelReading(null), shortlist([id])]);
      const record = await readPhotoEvidence(session, input, provider);
      await expect(
        analyzeCampusPhoto(session, comparisonInput(input, record.evidence.id), provider, record),
      ).rejects.toThrow('invalid or unsupplied');
    },
  );
  it('rejects invented labels or mismatched source coordinates instead of setting a position', async () => {
    const session = newSession(),
      input = photoInput();
    const response = comparison();
    (
      response[0].functionCall!.args as { candidates: { bounds: number[] }[] }
    ).candidates[0].bounds = [0.8, 0.1, 0.2, 0.5];
    const { provider } = fixture([labelReading(), response]);
    const record = await readPhotoEvidence(session, input, provider);
    await expect(
      analyzeCampusPhoto(session, comparisonInput(input, record.evidence.id), provider, record),
    ).rejects.toThrow('region coordinates');
    expect(session.campusLocation).toBeNull();
  });
  it('rejects more than one final candidate', () => {
    const args = comparison()[0].functionCall!.args as { candidates: unknown[] };
    args.candidates.push(args.candidates[0]);
    expect(comparisonSchema.safeParse(args).success).toBe(false);
  });
  it('cancels either stage without committing stale evidence or a result', async () => {
    const first = new AbortController(),
      session = newSession(),
      input = photoInput();
    const provider: Provider = {
      calls: 0,
      async generate(_contents, _tools, _signal, onAttempt) {
        onAttempt?.();
        this.calls++;
        first.abort();
        return labelReading();
      },
    };
    await expect(readPhotoEvidence(session, input, provider, first.signal)).rejects.toThrow(
      'cancelled',
    );
    expect(session.photoEvidence).toBeNull();
    const fixtureProvider = fixture([labelReading()]).provider;
    const record = await readPhotoEvidence(session, input, fixtureProvider);
    const second = new AbortController();
    second.abort();
    await expect(
      analyzeCampusPhoto(
        session,
        comparisonInput(input, record.evidence.id),
        fixtureProvider,
        record,
        second.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(session.campusAnalysis).toBeNull();
  });
  it('binds first-stage evidence to its session, complete image bundle and expiry', async () => {
    const session = newSession(),
      input = photoInput();
    const { provider } = fixture([labelReading()]);
    const record = await readPhotoEvidence(session, input, provider);
    const request = comparisonInput(input, record.evidence.id);
    expect(requirePhotoEvidence(session, request, record)).toMatchObject({
      id: record.evidence.id,
    });
    expect(() => requirePhotoEvidence(newSession(), request, record)).toThrow('labels first');
    expect(() =>
      requirePhotoEvidence(session, { ...request, evidenceId: randomUUID() }, record),
    ).toThrow('labels first');
    expect(() =>
      requirePhotoEvidence(session, { ...request, buildingHint: 'SW1' }, record),
    ).toThrow('changed');
    expect(() =>
      requirePhotoEvidence(session, request, {
        ...record,
        evidence: { ...record.evidence, expiresAt: new Date(0).toISOString() },
      }),
    ).toThrow('expired');
  });
  it('validates consent, crop coverage, image format and aggregate media size before spending calls', () => {
    const input = photoInput();
    expect(photoEvidenceRequestSchema.safeParse({ ...input, consent: false }).success).toBe(false);
    expect(photoRequestSchema.safeParse(input).success).toBe(false);
    expect(
      photoEvidenceRequestSchema.safeParse({ ...input, detailCrops: input.detailCrops.slice(1) })
        .success,
    ).toBe(false);
    expect(
      photoEvidenceRequestSchema.safeParse({
        ...input,
        detailCrops: [input.detailCrops[0], ...input.detailCrops.slice(0, 3)],
      }).success,
    ).toBe(false);
    const wrongBounds = structuredClone(input);
    wrongBounds.detailCrops[0].bounds[2] = 0.8;
    expect(photoEvidenceRequestSchema.safeParse(wrongBounds).success).toBe(false);
    const wrongFormat = structuredClone(input);
    wrongFormat.detailCrops[0].image.mimeType = 'image/jpeg';
    expect(() => validatePhotoBundle(wrongFormat)).toThrow('format');
    const huge = structuredClone(input);
    const data = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.alloc(600_000),
    ]).toString('base64');
    huge.image.data = data;
    huge.detailCrops.forEach((crop) => {
      crop.image.data = data;
    });
    expect(() => validatePhotoBundle(huge)).toThrow('2.5 MB');
  });
  it('preserves fallback disclosure across both API stages', async () => {
    const session = newSession(),
      input = photoInput();
    const { provider } = fixture([labelReading(), comparison()]);
    const original = provider.generate.bind(provider);
    provider.generate = async (contents, tools, signal, onAttempt, options) => {
      if (provider.calls === 0) options?.onModelFallback?.();
      return original(contents, tools, signal, onAttempt, options);
    };
    const record = await readPhotoEvidence(session, input, provider);
    expect(record.evidence.usedFallbackModel).toBe(true);
    const result = await analyzeCampusPhoto(
      session,
      comparisonInput(input, record.evidence.id),
      provider,
      record,
    );
    expect(result.usedFallbackModel).toBe(true);
  });
  it('rejects an unexpected first-stage tool without allowing it to select a plan', async () => {
    const session = newSession();
    const { provider } = fixture([shortlist()]);
    await expect(readPhotoEvidence(session, photoInput(), provider)).rejects.toThrow(
      'invalid photo label evidence',
    );
    expect(session.photoEvidence).toBeNull();
    expect(session.campusAnalysis).toBeNull();
  });
  it('retains the original source geometry and unreviewed status', () => {
    const geometry = planGeometrySummary(getVisualPlan('SE12-F3-p1'));
    expect(geometry.extraction.semanticClassification).toBe('unclassified');
    expect(geometry.coordinateSystem.geographic).toBe(false);
    expect(geometry.totalPrimitives).toBeGreaterThan(100);
    expect(geometry.sampledSegmentCount).toBeLessThanOrEqual(128);
  });
});
