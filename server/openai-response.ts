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
const invalid = () =>
  new ProviderError(
    'OpenAI returned an unsupported response. No AI action was applied.',
    502,
    'response',
    false,
  );
const blocked = () =>
  new ProviderError(
    'OpenAI blocked this request or response. Try another photo. No AI action was applied.',
    422,
    'blocked',
    false,
  );

export function parseOpenAiResponse(
  body: unknown,
  allowedNames: string[],
  forceTool?: string,
): ModelPart[] {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw invalid();
  if (parsed.data.status === 'incomplete') {
    if (parsed.data.incomplete_details?.reason === 'content_filter') throw blocked();
    throw new ProviderError(
      'OpenAI did not finish its response. No AI action was applied. Try again.',
      502,
      'response_limit',
      true,
    );
  }
  if (parsed.data.status !== 'completed') throw invalid();
  const parts: ModelPart[] = [];
  for (const item of parsed.data.output ?? []) {
    if (!item || typeof item !== 'object' || !('type' in item)) throw invalid();
    // Do not expose or retain reasoning items, signatures, usage or other provider metadata.
    if (item.type === 'reasoning') continue;
    if (item.type === 'function_call') {
      const call = functionSchema.safeParse(item);
      if (!call.success || !allowedNames.includes(call.data.name)) throw invalid();
      let args: unknown;
      try {
        args = JSON.parse(call.data.arguments);
      } catch {
        throw invalid();
      }
      const object = z.record(z.string(), z.unknown()).safeParse(args);
      if (!object.success) throw invalid();
      parts.push({ functionCall: { name: call.data.name, args: object.data } });
    } else {
      const message = messageSchema.safeParse(item);
      if (!message.success) throw invalid();
      for (const content of message.data.content) {
        if (content.type === 'refusal') throw blocked();
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
    throw invalid();
  return parts;
}
