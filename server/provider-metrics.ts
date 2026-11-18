/** Numeric request telemetry excludes prompts, image bytes, labels and visitor/session identifiers. */
import sharp from 'sharp';
import type { ModelContent } from './provider';

export type ProviderMetric = {
  provider: string;
  model: string;
  operation: string;
  attempt: number;
  outcome: 'success' | 'failure';
  code?: string;
  httpStatus?: number;
  requestId?: string;
  preparationMs: number;
  requestBytes: number;
  imageCount: number;
  imagePixels: number;
  textCharacters: number;
  headersMs?: number;
  firstEventMs?: number;
  firstOutputMs?: number;
  elapsedMs: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};
export type MetricSink = (metric: ProviderMetric) => void;

export async function measureInput(contents: ModelContent[]) {
  const parts = contents.flatMap((content) => content.parts);
  const images = parts.flatMap((part) => (part.inlineData ? [part.inlineData] : []));
  const pixels = await Promise.all(
    images.map(async (image) => {
      const metadata = await sharp(Buffer.from(image.data, 'base64'))
        .metadata()
        .catch(() => null);
      return (metadata?.width ?? 0) * (metadata?.height ?? 0);
    }),
  );
  return {
    imageCount: images.length,
    imagePixels: pixels.reduce((sum, count) => sum + count, 0),
    textCharacters: parts.reduce((sum, part) => sum + (part.text?.length ?? 0), 0),
  };
}

export function upstreamRequestId(response: Response) {
  const id = response.headers.get('x-request-id') ?? response.headers.get('x-goog-request-id');
  return id && /^[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : undefined;
}

export function tokenUsage(body: unknown, provider: string): Partial<ProviderMetric> {
  const object = body as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    };
    usageMetadata?: {
      promptTokenCount?: number;
      cachedContentTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  } | null;
  const usage = object?.usage,
    gemini = object?.usageMetadata;
  const values =
    provider === 'gemini'
      ? {
          inputTokens: gemini?.promptTokenCount,
          cachedInputTokens: gemini?.cachedContentTokenCount,
          outputTokens: gemini?.candidatesTokenCount,
          reasoningTokens: gemini?.thoughtsTokenCount,
        }
      : {
          inputTokens: usage?.input_tokens,
          cachedInputTokens: usage?.input_tokens_details?.cached_tokens,
          outputTokens: usage?.output_tokens,
          reasoningTokens: usage?.output_tokens_details?.reasoning_tokens,
        };
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    ),
  );
}

export function emitMetric(sink: MetricSink | undefined, metric: ProviderMetric) {
  // An optional observer must not affect an otherwise valid inference response.
  try {
    sink?.(metric);
  } catch {
    /* Metrics are best-effort and contain no media. */
  }
}
