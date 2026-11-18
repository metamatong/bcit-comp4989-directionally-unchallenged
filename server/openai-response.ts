/** Accept only completed visible OpenAI outputs; partial calls never reach application tools. */
import { z } from 'zod';
import { ProviderError, type ModelPart } from './provider';

const responseSchema = z.object({
  status: z.string(),
  incomplete_details: z.object({ reason: z.string() }).nullish(),
  output: z.array(z.unknown()).max(64).optional(),
});
const functionSchema = z.object({
  type: z.literal('function_call'),
  status: z.literal('completed'),
  name: z.string().min(1).max(80),
  arguments: z.string().max(65536),
});
const messageSchema = z.object({
  type: z.literal('message'),
  status: z.literal('completed'),
  role: z.literal('assistant'),
  content: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('output_text'), text: z.string().max(8000) }),
        z.object({ type: z.literal('refusal') }),
      ]),
    )
    .max(8),
});
const invalid = (provider = 'OpenAI') =>
  new ProviderError(
    `${provider} returned an unsupported response. No AI action was applied.`,
    502,
    'response',
    false,
  );
const blocked = (provider = 'OpenAI') =>
  new ProviderError(
    `${provider} blocked this request or response. Try another photo. No AI action was applied.`,
    422,
    'blocked',
    false,
  );

export function parseOpenAiResponse(
  body: unknown,
  allowedNames: string[],
  forceTool?: string,
  provider = 'OpenAI',
): ModelPart[] {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw invalid(provider);
  if (parsed.data.status === 'incomplete') {
    if (parsed.data.incomplete_details?.reason === 'content_filter') throw blocked(provider);
    throw new ProviderError(
      parsed.data.incomplete_details?.reason === 'max_output_tokens'
        ? `${provider} reached the response length limit before completing the result. No AI action was applied. Try again.`
        : `${provider} did not finish its response. No AI action was applied. Try again.`,
      502,
      'response_limit',
      true,
    );
  }
  if (parsed.data.status !== 'completed') throw invalid(provider);
  const parts: ModelPart[] = [];
  for (const item of parsed.data.output ?? []) {
    if (!item || typeof item !== 'object' || !('type' in item)) throw invalid(provider);
    // Do not expose or retain reasoning items, signatures, usage or other provider metadata.
    if (item.type === 'reasoning') continue;
    if (item.type === 'function_call') {
      const call = functionSchema.safeParse(item);
      if (!call.success || !allowedNames.includes(call.data.name)) throw invalid(provider);
      let args: unknown;
      try {
        args = JSON.parse(call.data.arguments);
      } catch {
        throw invalid(provider);
      }
      const object = z.record(z.string(), z.unknown()).safeParse(args);
      if (!object.success) throw invalid(provider);
      parts.push({ functionCall: { name: call.data.name, args: object.data } });
    } else {
      const message = messageSchema.safeParse(item);
      if (!message.success) throw invalid(provider);
      for (const content of message.data.content) {
        if (content.type === 'refusal') throw blocked(provider);
        if (content.text.trim()) parts.push({ text: content.text });
      }
    }
  }
  const calls = parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
  if (
    !parts.length ||
    parts.length > 8 ||
    (forceTool && (calls.length !== 1 || calls[0].name !== forceTool))
  )
    throw invalid(provider);
  return parts;
}
