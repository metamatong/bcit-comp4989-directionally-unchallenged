/** Provider selection is server-owned and inactive-provider credentials are irrelevant. */
import { describe, expect, it } from 'vitest';
import {
  liveAiModel,
  liveAiProvider,
  liveAiSetupIssue,
  liveAiFallbackModels,
  openAiApiModel,
  providerRequestLimits,
} from '../server/provider-config';

describe('provider configuration', () => {
  const gemini = { GEMINI_API_KEY: 'private-gemini', AI_FREE_TIER_CONFIRMED: 'true' };
  const openai = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'private-openai' };
  it('sets a shared budget of 120 attempts per minute and 1,200 per rolling day', () => {
    expect(providerRequestLimits({})).toMatchObject({
      requestsPerMinute: 120,
      requestsPerDay: 1200,
    });
  });

  it.each([
    ['120', '1200', 120, 1200],
    ['6', '60', 6, 60],
    ['450', '25000', 400, 20000],
  ])(
    'applies configured request limits %s and %s',
    (minute, day, requestsPerMinute, requestsPerDay) => {
      expect(
        providerRequestLimits({ AI_REQUESTS_PER_MINUTE: minute, AI_REQUESTS_PER_DAY: day }),
      ).toMatchObject({
        requestsPerMinute,
        requestsPerDay,
      });
    },
  );

  it('defaults to Gemini and preserves its current model/fallback settings', () => {
    expect(liveAiProvider({})).toBe('gemini');
    expect(liveAiSetupIssue({ ...gemini, OPENAI_MODEL: '', OPENAI_API_KEY: '' })).toBeNull();
    expect(liveAiModel({})).toBe('gemini-3.1-flash-lite');
    expect(liveAiModel({ GEMINI_MODEL: 'gemini-3.6-flash' })).toBe('gemini-3.6-flash');
    expect(liveAiFallbackModels({})).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
  });
  it('selects paid OpenAI without requiring Gemini credentials or free-tier confirmation', () => {
    expect(liveAiProvider(openai)).toBe('openai');
    expect(liveAiModel(openai)).toBe('luna-6.0');
    expect(openAiApiModel(liveAiModel(openai))).toBe('gpt-6-luna');
    expect(
      liveAiSetupIssue({ ...openai, AI_FREE_TIER_CONFIRMED: 'false', GEMINI_MODEL: 'invalid' }),
    ).toBeNull();
    expect(liveAiFallbackModels({ ...openai, GEMINI_FALLBACK_MODELS: 'invalid' })).toEqual([]);
    expect(liveAiModel({ ...openai, OPENAI_MODEL: 'gpt-6-sol' })).toBe('gpt-6-sol');
  });
  it('rejects unknown provider choices and missing selected credentials without using another key', () => {
    expect(liveAiSetupIssue({ ...gemini, AI_PROVIDER: 'other' })).toContain('AI_PROVIDER must be');
    expect(liveAiSetupIssue({ ...gemini, AI_PROVIDER: '' })).toContain('AI_PROVIDER must be');
    expect(liveAiSetupIssue({ ...gemini, AI_PROVIDER: 'openai' })).toContain(
      'OPENAI_API_KEY is missing',
    );
    expect(liveAiSetupIssue({ ...openai, AI_PROVIDER: 'gemini' })).toContain(
      'GEMINI_API_KEY is missing',
    );
    expect(liveAiSetupIssue({ ...openai, OPENAI_API_KEY: '  ' })).toContain(
      'OPENAI_API_KEY is missing',
    );
    expect(liveAiSetupIssue({ ...openai, OPENAI_MODEL: '' })).toContain('OPENAI_MODEL');
    expect(liveAiSetupIssue({ ...gemini, AI_FREE_TIER_CONFIRMED: 'false' })).toContain(
      'AI_FREE_TIER_CONFIRMED',
    );
  });
});
