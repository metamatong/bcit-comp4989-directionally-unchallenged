import { describe, expect, it, vi } from 'vitest';
import {
  GeminiProvider,
  ProviderError,
  isLiveAiConfigured,
  liveAiSetupIssue,
} from '../server/provider';

describe('live configuration', () => {
  it.each([
    { environment: {}, expected: 'GEMINI_API_KEY is missing' },
    {
      environment: { GEMINI_API_KEY: 'private-test-key' },
      expected: 'AI_FREE_TIER_CONFIRMED must be true',
    },
    {
      environment: {
        GEMINI_API_KEY: 'private-test-key',
        AI_FREE_TIER_CONFIRMED: 'true',
        GEMINI_MODEL: 'private-invalid-value',
      },
      expected: 'GEMINI_MODEL is not supported',
    },
  ])(
    'explains the missing configuration without leaking values: $expected',
    ({ environment, expected }) => {
      const issue = liveAiSetupIssue(environment);
      expect(issue).toContain(expected);
      expect(issue).not.toContain('private-test-key');
      expect(issue).not.toContain('private-invalid-value');
    },
  );
  it.each(['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'])(
    'accepts the reviewed model %s with a key and free-tier confirmation',
    (model) => {
      expect(
        isLiveAiConfigured({
          GEMINI_API_KEY: 'test-key',
          GEMINI_MODEL: model,
          AI_FREE_TIER_CONFIRMED: 'true',
        }),
      ).toBe(true);
    },
  );
  it('accepts documented Gemini Flash free-tier fallback models', () => {
    for (const model of ['gemini-2.5-flash-lite', 'gemini-2.5-flash']) {
      expect(
        isLiveAiConfigured({
          GEMINI_API_KEY: 'test-key',
          GEMINI_MODEL: 'gemini-3.6-flash',
          GEMINI_FALLBACK_MODELS: model,
          AI_FREE_TIER_CONFIRMED: 'true',
        }),
      ).toBe(true);
    }
  });
  it('rejects unsupported or excessive Gemini fallbacks', () => {
    const configured = {
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-2.5-flash-lite',
      AI_FREE_TIER_CONFIRMED: 'true',
    };
    expect(liveAiSetupIssue({ ...configured, GEMINI_FALLBACK_MODELS: 'unknown-model' })).toContain(
      'unsupported model',
    );
    expect(
      liveAiSetupIssue({
        ...configured,
        GEMINI_FALLBACK_MODELS: 'gemini-2.5-flash,gemini-3.6-flash,gemini-3.8-flash',
      }),
    ).toContain('at most 2');
  });
  it('keeps live AI disabled for absent credentials, unconfirmed tiers, or unreviewed models', () => {
    const configured = {
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-3.8-flash',
      AI_FREE_TIER_CONFIRMED: 'true',
    };
    expect(isLiveAiConfigured({ ...configured, GEMINI_API_KEY: '  ' })).toBe(false);
    expect(isLiveAiConfigured({ ...configured, AI_FREE_TIER_CONFIRMED: 'false' })).toBe(false);
    expect(isLiveAiConfigured({ ...configured, GEMINI_MODEL: 'unreviewed-model' })).toBe(false);
  });
});
describe('provider transport and free-tier request controls', () => {
  const options = {
    apiKey: 'fake-test-key',
    model: 'gemini-3.5-flash-lite',
    requestsPerMinute: 6,
    requestsPerDay: 60,
    timeoutMs: 20,
    waitForRetry: async () => {},
  };
  it('uses a server header for the key and validates returned parts', async () => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ thought: true, text: 'never logged' }, { text: 'Done' }] } },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GeminiProvider({ ...options, fetchImpl: fake });
    expect(await provider.generate([{ role: 'user', parts: [{ text: 'test' }] }], [])).toEqual([
      { text: 'Done' },
    ]);
    expect(String(fake.mock.calls[0][0])).not.toContain('fake-test-key');
    expect((fake.mock.calls[0][1]?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'fake-test-key',
    );
    const body = JSON.parse(String(fake.mock.calls[0][1]?.body));
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 1800,
      thinkingConfig: { includeThoughts: false },
    });
  });
  it('handles quota exhaustion without retrying or switching to paid service', async () => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    const provider = new GeminiProvider({ ...options, fetchImpl: fake });
    await expect(provider.generate([], [])).rejects.toThrow('quota');
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('tries the next configured Gemini model after quota exhaustion', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(
        Response.json({
          candidates: [{ content: { parts: [{ text: 'Fallback succeeded' }] } }],
        }),
      );
    const onModelFallback = vi.fn();
    const provider = new GeminiProvider({
      ...options,
      model: 'gemini-3.6-flash',
      fallbackModels: ['gemini-2.5-flash-lite'],
      fetchImpl: fake,
    });
    expect(await provider.generate([], [], undefined, undefined, { onModelFallback })).toEqual([
      { text: 'Fallback succeeded' },
    ]);
    expect(String(fake.mock.calls[0][0])).toContain('/gemini-3.6-flash:');
    expect(String(fake.mock.calls[1][0])).toContain('/gemini-2.5-flash-lite:');
    expect(onModelFallback).toHaveBeenCalledTimes(1);
  });
  it('reports when every configured Gemini model is exhausted', async () => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    const provider = new GeminiProvider({
      ...options,
      fallbackModels: ['gemini-2.5-flash'],
      fetchImpl: fake,
    });
    await expect(provider.generate([], [])).rejects.toThrow(
      'All configured Gemini models failed. Gemini quota exhausted.',
    );
    expect(fake).toHaveBeenCalledTimes(2);
  });
  it('bounds service-unavailable retries', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}', { status: 503 }));
    const pause = vi.fn(async (_milliseconds: number, _signal?: AbortSignal) => {});
    const provider = new GeminiProvider({ ...options, fetchImpl: fake, waitForRetry: pause });
    await expect(provider.generate([], [])).rejects.toMatchObject({
      httpStatus: 503,
      code: 'unavailable',
      retryable: true,
    });
    expect(fake).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(pause.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(pause.mock.calls[0][0]).toBeLessThan(1250);
    expect(pause.mock.calls[1][0]).toBeGreaterThanOrEqual(2000);
    expect(pause.mock.calls[1][0]).toBeLessThan(2250);
  });
  it('recovers from a transient 503 without changing model', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Provider recovered' }] } }],
          }),
        ),
      );
    const provider = new GeminiProvider({ ...options, model: 'gemini-3.8-flash', fetchImpl: fake });
    expect(await provider.generate([], [])).toEqual([{ text: 'Provider recovered' }]);
    expect(fake).toHaveBeenCalledTimes(2);
    expect(fake.mock.calls.every((call) => String(call[0]).includes('gemini-3.8-flash'))).toBe(
      true,
    );
  });
  it('honors a short Retry-After header', async () => {
    const pause = vi.fn(async (_milliseconds: number) => {});
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '4' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ready' }] } }] })),
      );
    await new GeminiProvider({ ...options, fetchImpl: fake, waitForRetry: pause }).generate([], []);
    expect(pause.mock.calls[0][0]).toBe(4000);
  });
  it('returns long Retry-After guidance without retrying earlier than requested', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 503, headers: { 'Retry-After': '60' } }));
    const pause = vi.fn(async () => {});
    const provider = new GeminiProvider({ ...options, fetchImpl: fake, waitForRetry: pause });
    await expect(provider.generate([], [])).rejects.toMatchObject({
      retryAfterSeconds: 60,
      httpStatus: 503,
    });
    expect(fake).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
  it('stops retrying when the turn is cancelled and does not charge another attempt', async () => {
    const cancellation = new AbortController();
    const fake = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}', { status: 503 }));
    const provider = new GeminiProvider({
      ...options,
      fetchImpl: fake,
      waitForRetry: async () => {
        cancellation.abort();
      },
    });
    await expect(provider.generate([], [], cancellation.signal)).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(provider.calls).toBe(1);
  });
  it('counts retries against the request budget', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}', { status: 503 }));
    const provider = new GeminiProvider({ ...options, requestsPerMinute: 1, fetchImpl: fake });
    await expect(provider.generate([], [])).rejects.toMatchObject({
      code: 'budget',
      httpStatus: 429,
    });
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('does not retry configuration errors or expose raw provider error content', async () => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'fake-test-key private content' } }), {
        status: 403,
      }),
    );
    const provider = new GeminiProvider({
      ...options,
      fallbackModels: ['gemini-2.5-flash'],
      fetchImpl: fake,
    });
    let failure: unknown;
    try {
      await provider.generate([], []);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ code: 'configuration', retryable: false });
    expect((failure as Error).message).not.toContain('fake-test-key');
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('falls back when the primary model ID is unavailable, but preserves the key error for 403', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          candidates: [{ content: { parts: [{ text: 'Fallback model available' }] } }],
        }),
      );
    const provider = new GeminiProvider({
      ...options,
      fallbackModels: ['gemini-2.5-flash'],
      fetchImpl: fake,
    });
    expect(await provider.generate([], [])).toEqual([{ text: 'Fallback model available' }]);
    expect(fake).toHaveBeenCalledTimes(2);
  });
  it('enforces a shared provider budget', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Done' }] } }] }),
          ),
      );
    const provider = new GeminiProvider({ ...options, requestsPerMinute: 1, fetchImpl: fake });
    await provider.generate([], []);
    await expect(provider.generate([], [])).rejects.toThrow('budget');
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('handles timeouts, connectivity failures and malformed responses', async () => {
    const offline = new GeminiProvider({
      ...options,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    });
    await expect(offline.generate([], [])).rejects.toThrow('unavailable');
    const malformed = new GeminiProvider({
      ...options,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
    });
    await expect(malformed.generate([], [])).rejects.toThrow('unsupported response');
    const timeout = new GeminiProvider({
      ...options,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
        ),
    });
    await expect(timeout.generate([], [])).rejects.toThrow('timed out');
  });
  it('requires credentials', async () => {
    await expect(new GeminiProvider({ ...options, apiKey: '' }).generate([], [])).rejects.toThrow(
      'not configured',
    );
  });
});
