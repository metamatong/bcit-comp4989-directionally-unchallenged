/** Stateless Responses API adapter for the shared, source-grounded photo workflow. */
import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import {
  ProviderError,
  providerSystemInstruction,
  type GenerationOptions,
  type ModelContent,
  type ModelPart,
  type Provider,
} from './provider';
import { openAiApiModel } from './provider-config';
import { ProviderBudget, type ProviderBudgetOptions } from './provider-budget';
import { parseOpenAiResponse } from './openai-response';

const declarationSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

// Shared tool declarations use Gemini's uppercase schema types. Convert schema nodes only;
// property names and literal enum values (including exact room identifiers) remain untouched.
function jsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };
  if (typeof result.type === 'string') result.type = result.type.toLowerCase();
  if (result.properties && typeof result.properties === 'object')
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([name, value]) => [
        name,
        jsonSchema(value as Record<string, unknown>),
      ]),
    );
  if (result.items && typeof result.items === 'object')
    result.items = jsonSchema(result.items as Record<string, unknown>);
  return result;
}

function inputMessages(contents: ModelContent[]) {
  return contents.map((message) => ({
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.parts.map((part) => {
      if (part.thought || part.functionCall || part.functionResponse)
        throw new ProviderError(
          'OpenAI photo requests require fresh text and image input.',
          502,
          'configuration',
          false,
        );
      if (part.inlineData)
        return {
          type: 'input_image',
          detail: 'high',
          image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        };
      if (part.text !== undefined) return { type: 'input_text', text: part.text };
      throw new ProviderError('Unsupported OpenAI photo input.', 502, 'configuration', false);
    }),
  }));
}

function transportError(signal: AbortSignal): ProviderError {
  if (signal.aborted)
    return new ProviderError(
      signal.reason?.name === 'TimeoutError'
        ? 'OpenAI timed out before completing the response.'
        : 'The photo request was cancelled.',
      signal.reason?.name === 'TimeoutError' ? 504 : 499,
      signal.reason?.name === 'TimeoutError' ? 'timeout' : 'connection',
      signal.reason?.name === 'TimeoutError',
    );
  return new ProviderError(
    'The OpenAI connection is unavailable. Check the server connection and try again.',
    503,
    'connection',
    true,
  );
}

function retryDelay(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

type OpenAiOptions = ProviderBudgetOptions & {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  waitForRetry?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onModelFailure?: (event: {
    model: string;
    operation: string;
    code: ProviderError['code'];
    httpStatus: number;
    elapsedMs: number;
  }) => void;
};

export class OpenAiProvider implements Provider {
  readonly name = 'openai';
  calls = 0;
  private budget: ProviderBudget;
  constructor(private options: OpenAiOptions) {
    this.budget = new ProviderBudget(options);
  }

  async generate(
    contents: ModelContent[],
    declarations: unknown[],
    signal?: AbortSignal,
    onAttempt?: () => void,
    options: GenerationOptions = {},
  ): Promise<ModelPart[]> {
    const started = performance.now();
    try {
      return await this.request(contents, declarations, signal, onAttempt, options);
    } catch (error) {
      if (error instanceof ProviderError)
        this.options.onModelFailure?.({
          model: openAiApiModel(this.options.model),
          operation: options.forceTool ?? 'generate',
          code: error.code,
          httpStatus: error.httpStatus,
          elapsedMs: Math.round(performance.now() - started),
        });
      throw error;
    }
  }

  private async request(
    contents: ModelContent[],
    declarations: unknown[],
    signal: AbortSignal | undefined,
    onAttempt: (() => void) | undefined,
    options: GenerationOptions,
  ): Promise<ModelPart[]> {
    if (!this.options.apiKey.trim())
      throw new ProviderError(
        'OpenAI is not configured. Add OPENAI_API_KEY and restart.',
        503,
        'configuration',
        false,
      );
    const tools = declarations.map((item) => {
      const declaration = declarationSchema.parse(item);
      return {
        type: 'function',
        name: declaration.name,
        description: declaration.description,
        parameters: jsonSchema(declaration.parameters ?? { type: 'object', properties: {} }),
        // Preserve optional fields in the existing contracts; application Zod schemas validate results.
        strict: false,
      };
    });
    if (options.forceTool && !tools.some((tool) => tool.name === options.forceTool))
      throw new Error('Forced tool is not declared');
    const body = JSON.stringify({
      model: openAiApiModel(this.options.model),
      instructions: options.systemInstruction ?? providerSystemInstruction,
      input: inputMessages(contents),
      store: false,
      max_output_tokens: Math.min(8192, Math.max(1, options.maxOutputTokens ?? 1800)),
      ...(options.thinkingLevel ? { reasoning: { effort: options.thinkingLevel } } : {}),
      ...(tools.length ? { tools, parallel_tool_calls: false } : {}),
      ...(options.forceTool ? { tool_choice: { type: 'function', name: options.forceTool } } : {}),
    });
    if (Buffer.byteLength(body) > 18 * 1024 * 1024)
      throw new ProviderError(
        'The image comparison is too large. Use a smaller photo or narrow the plans.',
        413,
        'configuration',
        false,
      );
    const timeoutMs = Math.min(30000, options.timeoutMs ?? this.options.timeoutMs);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw transportError(signal);
      await this.budget.reserve();
      // Shared budget reservation is asynchronous; cancellation must be checked before sending media.
      if (signal?.aborted) throw transportError(signal);
      this.calls++;
      onAttempt?.();
      const deadline = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let response: Response;
      try {
        response = await (this.options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
          method: 'POST',
          signal: requestSignal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.apiKey}`,
          },
          body,
        });
      } catch {
        throw transportError(requestSignal);
      }
      if (!response.ok) {
        const delay = retryDelay(response);
        const seconds = delay === undefined ? undefined : Math.max(1, Math.ceil(delay / 1000));
        await response.body?.cancel();
        if ([500, 502, 503, 504].includes(response.status)) {
          if (attempt < 2 && (delay === undefined || delay <= 8000)) {
            try {
              const pause =
                this.options.waitForRetry ??
                (async (ms: number, cancellation?: AbortSignal) => {
                  await wait(ms, undefined, { signal: cancellation });
                });
              await pause(Math.max(1000 * 2 ** attempt, delay ?? 0), signal);
            } catch {
              if (signal?.aborted) throw transportError(signal);
              throw new ProviderError(
                'OpenAI retry was interrupted. Try again.',
                503,
                'connection',
                true,
              );
            }
            continue;
          }
          throw new ProviderError(
            'OpenAI is temporarily unavailable. Try again later.',
            503,
            'unavailable',
            true,
            seconds,
          );
        }
        if (response.status === 429)
          throw new ProviderError(
            'OpenAI quota or rate limit reached. Check API billing and limits before retrying.',
            429,
            'quota',
            true,
            seconds,
          );
        throw new ProviderError(
          response.status === 404
            ? 'The OpenAI model is unavailable for this API project. Check OPENAI_MODEL and model access.'
            : `OpenAI rejected the request (HTTP ${response.status}). Check OPENAI_API_KEY, OPENAI_MODEL and API access.`,
          502,
          'configuration',
          false,
        );
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch (error) {
        if (requestSignal.aborted || !(error instanceof SyntaxError))
          throw transportError(requestSignal);
        throw new ProviderError(
          'OpenAI returned unreadable JSON. No AI action was applied.',
          502,
          'response',
          false,
        );
      }
      if (requestSignal.aborted) throw transportError(requestSignal);
      return parseOpenAiResponse(
        json,
        tools.map((tool) => tool.name),
        options.forceTool,
      );
    }
    throw new ProviderError('OpenAI is temporarily unavailable.', 503, 'unavailable', true);
  }
}
