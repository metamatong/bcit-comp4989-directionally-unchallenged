/** Shared provider configuration for the local listener and hosted HTTP handler. */
import { createApp } from './app';
import {
  GeminiProvider,
  defaultGeminiModel,
  liveAiFallbackModels,
  liveAiSetupIssue,
} from './provider';
import { RedisVisitorSessions, redisRestCommand, sharedAiBudget } from './redis-visitor-sessions';

const bounded = (value: string | undefined, fallback: number, max: number) =>
  Math.max(1, Math.min(max, Number(value) || fallback));

export function configuredApplication(environment: NodeJS.ProcessEnv, hosted = false) {
  const model = environment.GEMINI_MODEL ?? defaultGeminiModel;
  const setupNotice = liveAiSetupIssue(environment);
  const liveAvailable = setupNotice === null;
  const apiKey = liveAvailable ? environment.GEMINI_API_KEY! : '';
  const redis = hosted
    ? redisRestCommand(
        environment.KV_REST_API_URL ?? environment.UPSTASH_REDIS_REST_URL ?? '',
        environment.KV_REST_API_TOKEN ?? environment.UPSTASH_REDIS_REST_TOKEN ?? '',
      )
    : undefined;
  const provider = new GeminiProvider({
    apiKey,
    model,
    fallbackModels: liveAiFallbackModels(environment),
    requestsPerMinute: bounded(environment.AI_REQUESTS_PER_MINUTE, 6, 20),
    requestsPerDay: bounded(environment.AI_REQUESTS_PER_DAY, 60, 1000),
    timeoutMs: bounded(environment.AI_TIMEOUT_MS, 15000, 20000),
    reserveSharedBudget: redis ? sharedAiBudget(redis, apiKey) : undefined,
    onModelFailure: (event) => console.warn('Gemini request failed', JSON.stringify(event)),
  });
  // Preview deployments cannot resume another deployment's visitor session.
  const sessions = redis
    ? new RedisVisitorSessions(
        redis,
        environment.VERCEL_DEPLOYMENT_ID ?? environment.VERCEL_URL ?? 'hosted-local',
      )
    : undefined;
  return {
    app: createApp({ provider, model, setupNotice, liveAvailable, hosted, sessions }),
    setupNotice,
  };
}
