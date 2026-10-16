import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  analyzeCampusPhoto,
  confirmCampusRegion,
  photoRequestSchema,
  validatePhotoBytes,
  type PhotoRequest,
} from '../server/photo-localization';
import {
  getVisualPlan,
  planAtlases,
  planGeometrySummary,
  visualPlans,
} from '../server/visual-data';
import { newSession } from '../server/session';
import type { GenerationOptions, ModelContent, ModelPart, Provider } from '../server/provider';

const image = {
  mimeType: 'image/png' as const,
  data: readFileSync('data/campus/visual/png/SE12-F1-p1/overview.png').toString('base64'),
};
const planId = 'SE12-F1-p1';
function input(overrides: Partial<PhotoRequest> = {}): PhotoRequest {
  return {
    requestId: randomUUID(),
    revision: 0,
    consent: true,
    description: '',
    image: { ...image },
    ...overrides,
  };
}
function shortlist(ids = [planId]): ModelPart[] {
  return [
    {
      functionCall: {
        name: 'select_floor_plans',
        args: {
          planIds: ids,
          observations: ['A long corridor and glazing are visible.'],
          explanation: 'Several floor layouts may fit; inspect these drawings.',
          clarification: 'Another view could distinguish similar corridors.',
        },
      },
    },
  ];
}
function comparison(overrides: Record<string, unknown> = {}): ModelPart[] {
  return [
    {
      functionCall: {
        name: 'propose_campus_locations',
        args: {
          outcome: 'candidates',
          observations: ['Visible corridor geometry.'],
          summary: 'A possible region requires confirmation.',
          clarification: 'Check the visible corridor arrangement.',
          candidates: [
            {
              planId,
              bounds: [0.2, 0.3, 0.5, 0.6],
              confidence: 'low',
              matches: [
                {
                  photoFeature: 'A straight corridor',
                  planFeature: 'An elongated passage visible in the drawing',
                },
              ],
              limitations: ['This is a synthetic test hypothesis, not a field observation.'],
            },
          ],
          ...overrides,
        },
      },
    },
  ];
}
function fixture(turns: ModelPart[][]) {
  const captures: { contents: ModelContent[]; options?: GenerationOptions }[] = [];
  const provider: Provider = {
    calls: 0,
    async generate(contents, _tools, _signal, onAttempt, options) {
      captures.push({ contents, options });
      onAttempt?.();
      this.calls++;
      return turns[this.calls - 1] ?? [];
    },
  };
  return { provider, captures };
}

describe('real-source multimodal localization contracts (mocked model)', () => {
  it('sends the actual photo with every real floor-plan overview, then selected PNGs and geometry; no OCR is required', async () => {
    const session = newSession();
    const { provider, captures } = fixture([shortlist(), comparison()]);
    const result = await analyzeCampusPhoto(session, input(), provider);
    expect(provider.calls).toBe(2);
    expect(captures[0].contents[0].parts.filter((part) => part.inlineData).length).toBe(
      planAtlases.length + 1,
    );
    for (const capture of captures) {
      expect(capture.contents[0].parts.some((part) => part.inlineData?.data === image.data)).toBe(
        true,
      );
      expect(capture.options?.systemInstruction).toContain('ACTUAL uploaded photograph');
      expect(capture.options?.systemInstruction).toContain(
        'Use only supplied official BCIT plan records',
      );
      expect(capture.options?.thinkingLevel).toBe('low');
    }
    expect(captures[0].options?.maxOutputTokens).toBe(4096);
    expect(captures[1].options?.maxOutputTokens).toBe(8192);
    expect(captures[1].options?.systemInstruction).toContain(
      'select only the single strongest remaining location',
    );
    const detailText = captures[1].contents[0].parts
      .flatMap((part) => (part.text ? [part.text] : []))
      .join('\n');
    expect(detailText).toContain('EXTRACTED GEOMETRY');
    expect(detailText).toContain('SE12-F1#page=1');
    expect(detailText).not.toContain('Cedar welcome desk');
    expect(result.atlasPlanCount).toBe(89);
    expect(result.candidates).toHaveLength(1);
    expect(result.usedFallbackModel).toBe(false);
    expect(result.candidates[0].building).toBe('SE12');
    expect(result.candidates[0].verification).toBe('unverified-ai-hypothesis');
    expect(session).not.toHaveProperty('currentNodeId');
    expect(session.campusLocation).toBeNull();
    expect(JSON.stringify(session).includes(image.data)).toBe(false);
  });
  it('confirms a real-source region without assigning a fictional node or route', async () => {
    const session = newSession();
    const { provider } = fixture([shortlist(), comparison()]);
    await analyzeCampusPhoto(session, input(), provider);
    confirmCampusRegion(session, session.campusAnalysis!.candidates[0].id);
    expect(session.campusLocation?.planId).toBe(planId);
    expect(session).not.toHaveProperty('currentNodeId');
    expect(session).not.toHaveProperty('route');
    expect(() => confirmCampusRegion(session, randomUUID())).toThrow('current photo comparison');
  });
  it('marks a result when a configured backup Gemini model was used', async () => {
    const provider: Provider = {
      calls: 0,
      async generate(_contents, _tools, _signal, onAttempt, options) {
        this.calls++;
        onAttempt?.();
        options?.onModelFallback?.();
        return this.calls === 1 ? shortlist() : comparison();
      },
    };
    const result = await analyzeCampusPhoto(newSession(), input(), provider);
    expect(result.candidates).toHaveLength(1);
    expect(result.usedFallbackModel).toBe(true);
  });
  it('abstains after visual inspection instead of substituting a demo location', async () => {
    const session = newSession();
    const { provider } = fixture([shortlist([])]);
    const result = await analyzeCampusPhoto(session, input(), provider);
    expect(result.outcome).toBe('insufficient_evidence');
    expect(result.candidates).toEqual([]);
    expect(provider.calls).toBe(1);
  });
  it('allows detailed comparison to conclude that a shortlist is insufficient', async () => {
    const { provider } = fixture([
      shortlist(),
      comparison({ outcome: 'insufficient_evidence', candidates: [] }),
    ]);
    const result = await analyzeCampusPhoto(newSession(), input(), provider);
    expect(result.candidates).toEqual([]);
    expect(result.detailedPlanIds).toEqual([planId]);
  });
  it('rejects multiple suggestions instead of returning a list of possible locations', async () => {
    const multipleCandidates = comparison();
    const args = multipleCandidates[0].functionCall!.args as {
      outcome: string;
      candidates: unknown[];
    };
    args.candidates.push({
      planId,
      bounds: [0.55, 0.35, 0.8, 0.65],
      confidence: 'low',
      matches: [{ photoFeature: 'Corridor', planFeature: 'A different passage' }],
      limitations: ['No field validation.'],
    });
    const { provider } = fixture([shortlist(), multipleCandidates]);
    const session = newSession();
    await expect(analyzeCampusPhoto(session, input(), provider)).rejects.toThrow(
      'more than one location suggestion',
    );
    expect(session.campusAnalysis).toBeNull();
  });
  it('uses a supplied building hint to narrow visual comparison, not a text-match requirement', async () => {
    const { provider, captures } = fixture([shortlist(), comparison()]);
    const result = await analyzeCampusPhoto(
      newSession(),
      input({ buildingHint: 'SE12' }),
      provider,
    );
    expect(result.atlasPlanCount).toBe(4);
    expect(captures[0].contents[0].parts.filter((part) => part.inlineData).length).toBe(5);
  });
  it.each(['demo-layout-v1', 'cedar-entry', '../../.env', 'NW999-F1-p1'])(
    'rejects invented or foreign plan ID %s',
    async (id) => {
      const session = newSession();
      const { provider } = fixture([shortlist([id])]);
      await expect(analyzeCampusPhoto(session, input(), provider)).rejects.toThrow(
        'invalid or unsupplied',
      );
      expect(session.campusAnalysis).toBeNull();
    },
  );
  it('rejects a candidate for a real plan that was not selected for detailed inspection', async () => {
    const candidate = {
      planId: 'SW1-F1-p1',
      bounds: [0.2, 0.3, 0.5, 0.6],
      confidence: 'low',
      matches: [{ photoFeature: 'Corridor', planFeature: 'Passage' }],
      limitations: ['Unverified'],
    };
    const { provider } = fixture([shortlist(), comparison({ candidates: [candidate] })]);
    const session = newSession();
    await expect(analyzeCampusPhoto(session, input(), provider)).rejects.toThrow(
      'invalid source IDs',
    );
    expect(session.campusAnalysis).toBeNull();
  });
  it('rejects out-of-range and inverted image coordinates', async () => {
    for (const bounds of [
      [-0.1, 0, 0.4, 0.4],
      [0.8, 0.1, 0.2, 0.4],
      [0, 0, 1, 1.2],
    ]) {
      const invalid = comparison();
      const args = invalid[0].functionCall!.args as { candidates: { bounds: number[] }[] };
      args.candidates[0].bounds = bounds;
      const { provider } = fixture([shortlist(), invalid]);
      await expect(analyzeCampusPhoto(newSession(), input(), provider)).rejects.toThrow(
        'region coordinates',
      );
    }
  });
  it('discards a stale response when the request is cancelled', async () => {
    const controller = new AbortController();
    const session = newSession();
    const provider: Provider = {
      calls: 0,
      async generate(_contents, _tools, _signal, onAttempt) {
        onAttempt?.();
        this.calls++;
        controller.abort();
        return shortlist();
      },
    };
    await expect(analyzeCampusPhoto(session, input(), provider, controller.signal)).rejects.toThrow(
      'cancelled or timed out',
    );
    expect(session.campusAnalysis).toBeNull();
    expect(session.providerCalls).toBe(1);
  });
  it('stops before a provider call for invalid media, missing consent, and unknown building', async () => {
    const { provider } = fixture([]);
    expect(photoRequestSchema.safeParse(input({ consent: false as true })).success).toBe(false);
    expect(() => validatePhotoBytes({ mimeType: 'image/jpeg', data: image.data })).toThrow(
      'format',
    );
    await expect(
      analyzeCampusPhoto(newSession(), input({ buildingHint: 'OTHER' }), provider),
    ).rejects.toThrow('building');
    expect(provider.calls).toBe(0);
  });
  it('does not execute a tool name embedded in a photo/model response', async () => {
    const { provider } = fixture([
      [{ functionCall: { name: 'report_disruption', args: { scenario: 'unreachable' } } }],
    ]);
    const session = newSession();
    await expect(analyzeCampusPhoto(session, input(), provider)).rejects.toThrow(
      'valid floor-plan comparison',
    );
    expect(session).not.toHaveProperty('events');
  });
  it('loads geometry tied to the original source and exposes its unreviewed status', () => {
    const plan = getVisualPlan(planId);
    const geometry = planGeometrySummary(plan);
    expect(visualPlans).toHaveLength(89);
    expect(geometry.extraction.semanticClassification).toBe('unclassified');
    expect(geometry.coordinateSystem.geographic).toBe(false);
    expect(geometry.coordinateSystem.metersPerPoint).toBeNull();
    expect(geometry.totalPrimitives).toBeGreaterThan(100);
    expect(geometry.sampledSegmentCount).toBeLessThanOrEqual(128);
  });
});
