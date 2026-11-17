/** Validate only the explicitly selected provider; never switch providers on failure. */
import type { AiProviderName } from '../src/ai-provider';

export const defaultGeminiModel = 'gemini-3.5-flash-lite';
export const defaultOpenAiModel = 'luna-6.0';
// The requested configuration alias resolves to OpenAI's documented public API ID.
export function openAiApiModel(model: string): string {
  return model === 'luna-6.0' ? 'gpt-6-luna' : model;
}

export function liveAiProvider(environment: NodeJS.ProcessEnv): AiProviderName {
  return environment.AI_PROVIDER === 'openai' ? 'openai' : 'gemini';
}

export function liveAiModel(environment: NodeJS.ProcessEnv): string {
  return liveAiProvider(environment) === 'openai'
    ? (environment.OPENAI_MODEL ?? defaultOpenAiModel)
    : (environment.GEMINI_MODEL ?? defaultGeminiModel);
}

// Gemini 2.5 is opt-in for existing projects; Google restricts it for new users.
const supportedFreeTierModels = new Set([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
]);
const defaultFallbackModels = [defaultGeminiModel, 'gemini-3.8-flash'];
const maximumFallbackModels = 2;

export function liveAiFallbackModels(environment: NodeJS.ProcessEnv): string[] {
  if (liveAiProvider(environment) === 'openai') return [];
  const configured = environment.GEMINI_FALLBACK_MODELS;
  const models = (configured === undefined ? defaultFallbackModels.join(',') : configured)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const primary = environment.GEMINI_MODEL ?? defaultGeminiModel;
  return [...new Set(models)].filter((model) => model !== primary);
}

export function liveAiSetupIssue(environment: NodeJS.ProcessEnv): string | null {
  if (
    environment.AI_PROVIDER !== undefined &&
    !['gemini', 'openai'].includes(environment.AI_PROVIDER)
  )
    return 'AI_PROVIDER must be gemini or openai. Update .env and restart.';
  if (liveAiProvider(environment) === 'openai') {
    if (!environment.OPENAI_API_KEY?.trim())
      return 'OPENAI_API_KEY is missing from the server environment. Add your paid API key to .env and restart.';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(liveAiModel(environment)))
      return 'OPENAI_MODEL must be a nonempty OpenAI model ID with image input and function calling support.';
    return null;
  }
  if (!environment.GEMINI_API_KEY?.trim())
    return 'GEMINI_API_KEY is missing from the server environment. Add it to .env and restart.';
  if (environment.AI_FREE_TIER_CONFIRMED !== 'true')
    return 'AI_FREE_TIER_CONFIRMED must be true after verifying the API project uses an eligible free tier.';
  if (!supportedFreeTierModels.has(environment.GEMINI_MODEL ?? defaultGeminiModel))
    return `GEMINI_MODEL is not supported. Supported models: ${[...supportedFreeTierModels].join(', ')}.`;
  const fallbackModels = liveAiFallbackModels(environment);
  if (fallbackModels.length > maximumFallbackModels)
    return `GEMINI_FALLBACK_MODELS supports at most ${maximumFallbackModels} fallback models.`;
  if (fallbackModels.some((model) => !supportedFreeTierModels.has(model)))
    return `GEMINI_FALLBACK_MODELS contains an unsupported model. Supported models: ${[...supportedFreeTierModels].join(', ')}.`;
  return null;
}

export function isLiveAiConfigured(environment: NodeJS.ProcessEnv): boolean {
  return liveAiSetupIssue(environment) === null;
}
