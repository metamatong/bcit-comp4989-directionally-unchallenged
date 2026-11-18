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
import type { AiProviderName } from '../src/ai-provider';
import { jsonSchema, inputMessages, groqInputMessages } from './openai-input';
import { readOpenAiResponse } from './openai-stream';
import { canRetryBeforeDeadline, remainingRequestMs } from './provider-timing';
import {
  emitMetric,
  measureInput,
  tokenUsage,
  upstreamRequestId,
  type MetricSink,
  type ProviderMetric,
} from './provider-metrics';

const declarationSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

function transportError(signal: AbortSignal, provider = 'OpenAI'): ProviderError {
  if (signal.aborted)
    return new ProviderError(
      signal.reason?.name === 'TimeoutError'
        ? `${provider} timed out before completing the response.`
        : 'The photo request was cancelled.',
      signal.reason?.name === 'TimeoutError' ? 504 : 499,
      signal.reason?.name === 'TimeoutError' ? 'timeout' : 'connection',
      signal.reason?.name === 'TimeoutError',
    );
  return new ProviderError(
    `The ${provider} connection is unavailable. Check the server connection and try again.`,
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
  providerName?: 'openai' | 'groq';
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  onMetric?: MetricSink;
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
  readonly name: AiProviderName;
  calls = 0;
  private budget: ProviderBudget;
  constructor(private options: OpenAiOptions) {
    this.name = options.providerName ?? 'openai';
    this.budget = new ProviderBudget(options);
  }

  private get providerLabel() {
    return this.name === 'groq' ? 'Groq' : 'OpenAI';
  }

  private get apiModel() {
    return this.name === 'openai' ? openAiApiModel(this.options.model) : this.options.model;
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
          model: this.apiModel,
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
        `${this.providerLabel} is not configured. Add the selected provider API key and restart.`,
        503,
        'configuration',
        false,
      );
    const preparationStarted = performance.now();
    const deadlineAt =
      options.deadlineAt ?? Date.now() + (options.timeoutMs ?? this.options.timeoutMs);
    const deadline = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
    const callSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
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
    const input =
      this.name === 'groq'
        ? await groqInputMessages(contents)
        : inputMessages(contents, this.providerLabel);
    const body = JSON.stringify({
      model: this.apiModel,
      instructions: options.systemInstruction ?? providerSystemInstruction,
      input,
      store: false,
      ...(this.name === 'openai' ? { stream: true } : {}),
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
    const inputMetrics = await measureInput(contents);
    const preparationMs = Math.round(
      performance.now() - preparationStarted + (options.preparationMs ?? 0),
    );
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = performance.now();
      const metric: ProviderMetric = {
        provider: this.name,
        model: this.apiModel,
        operation: options.forceTool ?? 'generate',
        attempt,
        outcome: 'failure',
        preparationMs,
        requestBytes: Buffer.byteLength(body),
        ...inputMetrics,
        elapsedMs: 0,
      };
      let failure: ProviderError | undefined;
      const attemptDeadline = AbortSignal.timeout(
        remainingRequestMs({ ...options, deadlineAt }, this.options.timeoutMs),
      );
      const requestSignal = AbortSignal.any([callSignal, attemptDeadline]);
      try {
        if (requestSignal.aborted) throw transportError(requestSignal, this.providerLabel);
        await this.budget.reserve();
        if (requestSignal.aborted) throw transportError(requestSignal, this.providerLabel);
        this.calls++;
        onAttempt?.();
        let response: Response;
        try {
          response = await (this.options.fetchImpl ?? fetch)(
            `${this.options.apiBaseUrl ?? 'https://api.openai.com/v1'}/responses`,
            {
              method: 'POST',
              signal: requestSignal,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.options.apiKey}`,
              },
              body,
            },
          );
        } catch {
          throw transportError(requestSignal, this.providerLabel);
        }
        metric.headersMs = Math.round(performance.now() - started);
        metric.requestId = upstreamRequestId(response);
        metric.httpStatus = response.status;
        if (!response.ok) {
          const delay = retryDelay(response);
          const seconds = delay === undefined ? undefined : Math.max(1, Math.ceil(delay / 1000));
          await response.body?.cancel();
          if ([500, 502, 503, 504].includes(response.status))
            throw new ProviderError(
              `${this.providerLabel} is temporarily unavailable. Try again later.`,
              503,
              'unavailable',
              true,
              seconds,
            );
          if (response.status === 429)
            throw new ProviderError(
              `${this.providerLabel} quota or rate limit reached. Check your account limits before retrying.`,
              429,
              'quota',
              true,
              seconds,
            );
          throw new ProviderError(
            response.status === 404
              ? `The ${this.providerLabel} model is unavailable for this API account. Check the configured model ID and access.`
              : `${this.providerLabel} rejected the request (HTTP ${response.status}). Check the selected provider key, model, and API access.`,
            502,
            'configuration',
            false,
          );
        }
        let json: unknown;
        try {
          json = await readOpenAiResponse(response, (hasOutput) => {
            metric.firstEventMs ??= Math.round(performance.now() - started);
            if (hasOutput) metric.firstOutputMs ??= Math.round(performance.now() - started);
          });
        } catch (error) {
          if (requestSignal.aborted) throw transportError(requestSignal, this.providerLabel);
          if (error instanceof ProviderError) throw error;
          if (!(error instanceof SyntaxError))
            throw transportError(requestSignal, this.providerLabel);
          throw new ProviderError(
            `${this.providerLabel} returned unreadable JSON. No AI action was applied.`,
            502,
            'response',
            false,
          );
        }
        if (requestSignal.aborted) throw transportError(requestSignal, this.providerLabel);
        Object.assign(metric, tokenUsage(json, this.name));
        const parts = parseOpenAiResponse(
          json,
          tools.map((tool) => tool.name),
          options.forceTool,
          this.providerLabel,
        );
        metric.outcome = 'success';
        return parts;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        failure = error;
        metric.code = error.code;
        metric.httpStatus ??= error.httpStatus;
      } finally {
        metric.elapsedMs = Math.round(performance.now() - started);
        emitMetric(this.options.onMetric, metric);
      }
      const pauseMs = Math.max(1000, (failure!.retryAfterSeconds ?? 0) * 1000);
      if (
        attempt === 2 ||
        callSignal.aborted ||
        !['connection', 'unavailable', 'timeout', 'quota'].includes(failure!.code) ||
        failure!.httpStatus === 499 ||
        !failure!.retryable ||
        !canRetryBeforeDeadline(deadlineAt, pauseMs)
      )
        throw failure;
      try {
        const pause =
          this.options.waitForRetry ??
          (async (ms: number, cancellation?: AbortSignal) => {
            await wait(ms, undefined, { signal: cancellation });
          });
        await pause(pauseMs, callSignal);
      } catch {
        throw transportError(callSignal, this.providerLabel);
      }
    }
    throw new ProviderError(
      `${this.providerLabel} is temporarily unavailable.`,
      503,
      'unavailable',
      true,
    );
  }
}
