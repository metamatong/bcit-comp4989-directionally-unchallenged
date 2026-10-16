import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeCampusPhoto, comparisonSchema } from '../server/photo-localization';
import { readPhotoEvidence, requirePhotoEvidence } from '../server/photo-evidence';
import {
  photoEvidenceRequestSchema,
  photoRequestSchema,
  validatePhotoBundle,
} from '../server/photo-media';
import { newSession } from '../server/session';
import { getVisualPlan, planAtlases, planGeometrySummary } from '../server/visual-data';
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
  it('reads the photo without plan hints, then retrieves all exact labels and compares SE12 floor 3 directly', async () => {
    const session = newSession();
    const input = photoInput();
    const { provider, captures } = fixture([labelReading(), comparison()]);
    const record = await readPhotoEvidence(session, input, provider);
    expect(session.campusAnalysis).toBeNull();
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
    expect(captures[1].contents[0].parts.filter((part) => part.inlineData)).toHaveLength(10);
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
    expect(result.labelRetrieval.indexedLabels).toBe(5463);
    expect(result.atlasPlanCount).toBe(0);
    expect(result.candidates[0].floor).toBe('3');
    expect(result.candidates[0].labelMatches).toEqual([{ observedLabel: '302', planLabel: '302' }]);
    expect(session.photoEvidence).toBeNull();
    expect(JSON.stringify(session)).not.toContain(input.image.data);
    expect(session.activity.map((entry) => entry.tool)).toEqual([
      'read_photo_labels',
      'retrieve_room_labels',
      'inspect_floor_plans',
      'photo_comparison_complete',
    ]);
    for (const capture of captures) expect(capture.options?.thinkingLevel).toBe('low');
  });
  it('keeps the photo result as an unverified estimate without adding confirmation state', async () => {
    const session = newSession(),
      input = photoInput();
    const { provider } = fixture([labelReading(), comparison()]);
    const record = await readPhotoEvidence(session, input, provider);
    await analyzeCampusPhoto(session, comparisonInput(input, record.evidence.id), provider, record);
    expect(session.campusAnalysis?.candidates[0].verification).toBe('unverified-ai-hypothesis');
    expect(session).not.toHaveProperty('campusLocation');
    expect(session).not.toHaveProperty('route');
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
      await expect(
        analyzeCampusPhoto(session, comparisonInput(input, record.evidence.id), provider, record),
      ).rejects.toThrow('non-exact');
      expect(session.campusAnalysis).toBeNull();
    },
  );
  it('requires a verified exact label in label-guided results, while allowing visual abstention', async () => {
    const response = comparison();
    (
      response[0].functionCall!.args as { candidates: { labelMatches: unknown[] }[] }
    ).candidates[0].labelMatches = [];
    const session = newSession(),
      input = photoInput();
    const { provider } = fixture([
      labelReading(),
      response,
      comparison({ outcome: 'insufficient_evidence', candidates: [] }),
    ]);
    const record = await readPhotoEvidence(session, input, provider);
    const request = comparisonInput(input, record.evidence.id);
    await expect(analyzeCampusPhoto(session, request, provider, record)).rejects.toThrow(
      'did not verify',
    );
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
  });
  it('rejects more than one final candidate', () => {
    const args = comparison()[0].functionCall!.args as { candidates: unknown[] };
    args.candidates.push(args.candidates[0]);
    expect(comparisonSchema.safeParse(args).success).toBe(false);
  });
  it('rejects a broad candidate highlight instead of presenting it as a location region', () => {
    const args = comparison()[0].functionCall!.args as {
      candidates: { bounds: number[] }[];
    };
    args.candidates[0].bounds = [0.1, 0.1, 0.6, 0.3];
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
