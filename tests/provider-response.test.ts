import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider, type GenerationOptions } from '../server/provider';

function transport(body: unknown) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body));
  const provider = new GeminiProvider({
    apiKey: 'fake-test-key',
    model: 'gemini-3.8-flash',
    requestsPerMinute: 6,
    requestsPerDay: 60,
    timeoutMs: 1000,
    fetchImpl: fetcher,
  });
  return { provider, fetcher };
}

describe('Gemini completion status and visible response validation', () => {
  it.each(['gemini-2.5-flash-lite', 'gemini-2.5-flash'])(
    'uses a bounded thinkingBudget for %s rather than an unsupported thinkingLevel',
    async (model) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Ready' }] } }],
        }),
      );
      const provider = new GeminiProvider({
        apiKey: 'fake-key',
        model,
        requestsPerMinute: 6,
        requestsPerDay: 60,
        timeoutMs: 1000,
        fetchImpl: fetcher,
      });
      await provider.generate([], [], undefined, undefined, {
        maxOutputTokens: 4096,
        thinkingLevel: 'low',
      });
      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
      expect(body.generationConfig.thinkingConfig).toEqual({
        includeThoughts: false,
        thinkingBudget: 1024,
      });
      expect(body.generationConfig.maxOutputTokens).toBe(4096);
    },
  );

  it('reports the observed HTTP-200 token exhaustion with no parts as an incomplete response', async () => {
    const { provider, fetcher } = transport({
      candidates: [{ content: { role: 'model' }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 12057, thoughtsTokenCount: 1726, totalTokenCount: 13783 },
    });
    await expect(provider.generate([], [])).rejects.toMatchObject({
      code: 'response_limit',
      retryable: true,
      message: expect.stringContaining('before finishing'),
    });
    // Do not spend repeated requests on a response that hit the same configured cap.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(provider.calls).toBe(1);
  });

  it.each(['MAX_TOKENS', 'CONTINUATION'])(
    'rejects even valid-looking partial tool arguments when generation ends with %s',
    async (finishReason) => {
      const { provider } = transport({
        candidates: [
          {
            finishReason,
            content: {
              parts: [{ functionCall: { name: 'select_floor_plans', args: { planIds: [] } } }],
            },
            continuationToken: 'opaque-continuation-must-not-trigger-another-call',
          },
        ],
      });
      await expect(provider.generate([], [])).rejects.toMatchObject({ code: 'response_limit' });
      expect(provider.calls).toBe(1);
    },
  );

  it('discards long thought parts before applying visible-output limits and preserves only the tool signature', async () => {
    const toolPart = {
      functionCall: { name: 'select_floor_plans', args: { planIds: [] } },
      thoughtSignature: 'opaque-signature-for-transient-history',
    };
    const { provider } = transport({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              ...Array.from({ length: 10 }, () => ({
                thought: true,
                text: 'private'.repeat(2000),
              })),
              { ...toolPart, internalMetadata: 'must not escape the adapter' },
            ],
          },
        },
      ],
    });
    expect(await provider.generate([], [])).toEqual([toolPart]);
  });

  it.each([
    { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'private provider detail' } },
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'blocked output' }] } }] },
  ])(
    'handles provider blocking without accepting content or exposing raw details',
    async (body) => {
      const { provider, fetcher } = transport(body);
      await expect(provider.generate([], [])).rejects.toMatchObject({
        code: 'blocked',
        retryable: false,
        httpStatus: 422,
        message:
          'Gemini blocked this request or response. Try another photo or revise the description. No AI action was applied.',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { candidates: [] },
    { candidates: [{ finishReason: 'STOP', content: { role: 'model' } }] },
    {
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private' }] } },
      ],
    },
  ])('does not treat an empty or thought-only answer as a completed turn', async (body) => {
    const { provider } = transport(body);
    await expect(provider.generate([], [])).rejects.toMatchObject({
      code: 'response',
      retryable: true,
      message: expect.stringContaining('no usable answer'),
    });
  });

  it('distinguishes malformed model calls from transport or credential failures', async () => {
    const { provider } = transport({ candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] });
    await expect(provider.generate([], [])).rejects.toMatchObject({
      code: 'response',
      retryable: true,
      message: expect.stringContaining('valid tool response'),
    });
  });

  it.each([
    { parts: [{ text: 'x'.repeat(8001) }] },
    { parts: [{ functionCall: { name: 'select_floor_plans', args: 'not an object' } }] },
    { parts: Array.from({ length: 9 }, () => ({ text: 'Too many visible parts' })) },
  ])('continues to reject malformed or oversized visible output', async ({ parts }) => {
    const { provider } = transport({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
    await expect(provider.generate([], [])).rejects.toMatchObject({
      code: 'response',
      retryable: false,
    });
  });

  it('rejects unknown non-success finish reasons without displaying raw provider text', async () => {
    const { provider } = transport({
      candidates: [
        {
          finishReason: 'UNKNOWN_REASON',
          finishMessage: 'private detail',
          content: { parts: [{ text: 'Partial answer' }] },
        },
      ],
    });
    await expect(provider.generate([], [])).rejects.toMatchObject({
      code: 'response',
      message: 'The provider returned an unsupported response. No AI action was applied.',
    });
  });

  it.each([4096, 8192, 100000])(
    'allows a bounded thinking/output budget of %i while preserving forced tools',
    async (requestedLimit) => {
      const { provider, fetcher } = transport({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Done' }] } }],
      });
      const options: GenerationOptions = {
        forceTool: 'select_floor_plans',
        thinkingLevel: 'low',
        maxOutputTokens: requestedLimit,
      };
      await provider.generate([], [{ name: 'select_floor_plans' }], undefined, undefined, options);
      const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
      expect(request.generationConfig).toEqual({
        maxOutputTokens: Math.min(8192, requestedLimit),
        thinkingConfig: { includeThoughts: false, thinkingLevel: 'low' },
      });
      expect(request.toolConfig.functionCallingConfig).toEqual({
        mode: 'ANY',
        allowedFunctionNames: ['select_floor_plans'],
      });
    },
  );
});
