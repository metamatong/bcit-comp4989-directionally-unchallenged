/** Shared provider configuration for the local listener and hosted HTTP handler. */
import { createApp } from './app';
import { GeminiProvider } from './provider';
import { OpenAiProvider } from './openai-provider';
import {
  liveAiProvider,
  liveAiModel,
  liveAiFallbackModels,
  liveAiSetupIssue,
  openAiApiModel,
  providerRequestLimits,
} from './provider-config';
import { aiProviderDetails } from '../src/ai-provider';
import type { ProviderMetric } from './provider-metrics';
import { RedisVisitorSessions, redisRestCommand, sharedAiBudget } from './redis-visitor-sessions';

export function configuredApplication(environment: NodeJS.ProcessEnv, hosted = false) {
  const providerName = liveAiProvider(environment);
  const providerLabel = aiProviderDetails(providerName).label;
  const selectedModel = liveAiModel(environment);
  const model = providerName === 'openai' ? openAiApiModel(selectedModel) : selectedModel;
  const setupNotice = liveAiSetupIssue(environment);
  const liveAvailable = setupNotice === null;
  const apiKey = liveAvailable
    ? (providerName === 'openai'
        ? environment.OPENAI_API_KEY!
        : providerName === 'groq'
          ? environment.GROQ_API_KEY!
          : environment.GEMINI_API_KEY!
      ).trim()
    : '';
  const redis = hosted
    ? redisRestCommand(
        environment.KV_REST_API_URL ?? environment.UPSTASH_REDIS_REST_URL ?? '',
        environment.KV_REST_API_TOKEN ?? environment.UPSTASH_REDIS_REST_TOKEN ?? '',
      )
    : undefined;
  const providerOptions = {
    apiKey,
    model,
    ...providerRequestLimits(environment),
    onMetric: (metric: ProviderMetric) => console.info('AI request metric', JSON.stringify(metric)),
    reserveSharedBudget: redis ? sharedAiBudget(redis, apiKey) : undefined,
    onModelFailure: (event: {
      model: string;
      operation: string;
      code: string;
      httpStatus: number;
      elapsedMs: number;
    }) => console.warn(`${providerLabel} request failed`, JSON.stringify(event)),
  };
  const provider =
    providerName === 'gemini'
      ? new GeminiProvider({
          ...providerOptions,
          // All attempts still reserve the shared budget identified by the primary key.
          fallbackApiKeys: [environment.GEMINI_API_KEY_2, environment.GEMINI_API_KEY_3],
          fallbackModels: liveAiFallbackModels(environment),
        })
      : new OpenAiProvider({
          ...providerOptions,
          providerName,
          ...(providerName === 'groq' ? { apiBaseUrl: 'https://api.groq.com/openai/v1' } : {}),
        });
  // Preview deployments cannot resume another deployment's visitor session.
  const sessions = redis
    ? new RedisVisitorSessions(
        redis,
        environment.VERCEL_DEPLOYMENT_ID ?? environment.VERCEL_URL ?? 'hosted-local',
      )
    : undefined;
  return {
    app: createApp({
      provider,
      model,
      setupNotice,
      liveAvailable,
      hosted,
      sessions,
    }),
    setupNotice,
    providerLabel,
  };
}
