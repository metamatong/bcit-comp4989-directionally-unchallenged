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
import sharp from 'sharp';

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

function inputMessages(contents: ModelContent[], provider = 'OpenAI') {
  return contents.map((message) => ({
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.parts.map((part) => {
      if (part.thought || part.functionCall || part.functionResponse)
        throw new ProviderError(
          `${provider} photo requests require fresh text and image input.`,
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
      throw new ProviderError(`Unsupported ${provider} photo input.`, 502, 'configuration', false);
    }),
  }));
}

function escapeSvg(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character];
  });
}

async function groqInputMessages(contents: ModelContent[]) {
  const converted = [];
  for (const message of contents) {
    const texts: string[] = [];
    const images: Array<{ data: Buffer; label: string }> = [];
    let label = 'Image';
    for (const part of message.parts) {
      if (part.thought || part.functionCall || part.functionResponse)
        throw new ProviderError(
          'Groq photo requests require fresh text and image input.',
          502,
          'configuration',
          false,
        );
      if (part.text !== undefined) {
        texts.push(part.text);
        label = part.text.replace(/\s+/g, ' ').slice(0, 110) || label;
      } else if (part.inlineData) {
        images.push({ data: Buffer.from(part.inlineData.data, 'base64'), label });
      } else {
        throw new ProviderError('Unsupported Groq photo input.', 502, 'configuration', false);
      }
    }
    const content: unknown[] = [];
    if (texts.length) content.push({ type: 'input_text', text: texts.join('\n\n') });
    if (images.length) {
      const columns = 3;
      const cellWidth = 480;
      const cellHeight = 400;
      const rows = Math.ceil(images.length / columns);
      const composites = await Promise.all(
        images.map(async (image, index) => {
          const left = (index % columns) * cellWidth;
          const top = Math.floor(index / columns) * cellHeight;
          const labelSvg = Buffer.from(
            `<svg width="${cellWidth}" height="44"><rect width="100%" height="100%" fill="#f0f3f2"/><text x="10" y="28" font-size="16" font-family="sans-serif" fill="#173d37">${escapeSvg(image.label)}</text></svg>`,
          );
          const resized = await sharp(image.data)
            .resize(cellWidth - 12, cellHeight - 56, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();
          const imageMeta = await sharp(resized).metadata();
          return [
            { input: labelSvg, left, top },
            {
              input: resized,
              left: left + Math.floor((cellWidth - (imageMeta.width ?? 0)) / 2),
              top: top + 44 + Math.floor((cellHeight - 44 - (imageMeta.height ?? 0)) / 2),
            },
          ];
        }),
      );
      const sheet = await sharp({
        create: {
          width: columns * cellWidth,
          height: rows * cellHeight,
          channels: 3,
          background: '#ffffff',
        },
      })
        .composite(composites.flat())
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      content.push({
        type: 'input_image',
        detail: 'high',
        image_url: `data:image/jpeg;base64,${sheet.toString('base64')}`,
      });
    }
    converted.push({ role: message.role === 'model' ? 'assistant' : 'user', content });
  }
  return converted;
}

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
      if (signal?.aborted) throw transportError(signal, this.providerLabel);
      await this.budget.reserve();
      // Shared budget reservation is asynchronous; cancellation must be checked before sending media.
      if (signal?.aborted) throw transportError(signal, this.providerLabel);
      this.calls++;
      onAttempt?.();
      const deadline = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
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
              if (signal?.aborted) throw transportError(signal, this.providerLabel);
              throw new ProviderError(
                `${this.providerLabel} retry was interrupted. Try again.`,
                503,
                'connection',
                true,
              );
            }
            continue;
          }
          throw new ProviderError(
            `${this.providerLabel} is temporarily unavailable. Try again later.`,
            503,
            'unavailable',
            true,
            seconds,
          );
        }
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
        json = await response.json();
      } catch (error) {
        if (requestSignal.aborted || !(error instanceof SyntaxError))
          throw transportError(requestSignal, this.providerLabel);
        throw new ProviderError(
          `${this.providerLabel} returned unreadable JSON. No AI action was applied.`,
          502,
          'response',
          false,
        );
      }
      if (requestSignal.aborted) throw transportError(requestSignal, this.providerLabel);
      return parseOpenAiResponse(
        json,
        tools.map((tool) => tool.name),
        options.forceTool,
        this.providerLabel,
      );
    }
    throw new ProviderError(
      `${this.providerLabel} is temporarily unavailable.`,
      503,
      'unavailable',
      true,
    );
  }
}
