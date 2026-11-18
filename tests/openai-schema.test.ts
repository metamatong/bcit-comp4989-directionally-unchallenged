/** Strict schemas preserve exact enums and optional route fields while bounding verbose output. */
import { expect, it, vi } from 'vitest';
import { OpenAiProvider } from '../server/openai-provider';
import { strictToolSchema, restoreOptionalFields } from '../server/openai-schema';
import { generatedRouteSchema, routeTool } from '../server/generated-route';
import type { ProviderMetric } from '../server/provider-metrics';

it('preserves an explicitly nullable required feature when its value is unknown', () => {
  const schema = {
    type: 'OBJECT',
    properties: { count: { type: 'INTEGER', nullable: true } },
    required: ['count'],
  };
  expect(strictToolSchema(schema)).toMatchObject({
    properties: { count: { anyOf: [{ type: 'integer' }, { type: 'null' }] } },
    required: ['count'],
  });
  expect(restoreOptionalFields({ count: null }, schema)).toEqual({ count: null });
});

it('makes nested objects closed and required, with null for optional values only', () => {
  const declaration = routeTool(['SW3-F1-p1'], ['SW3-F1-p1:plan-transcription:2']);
  const schema = strictToolSchema(declaration.parameters);
  expect(schema).toMatchObject({
    additionalProperties: false,
    required: Object.keys(declaration.parameters.properties),
    properties: {
      destinationId: { anyOf: [{ enum: ['SW3-F1-p1:plan-transcription:2'] }, { type: 'null' }] },
      origin: { anyOf: [{ additionalProperties: false }, { type: 'null' }] },
      steps: { anyOf: [{ items: { additionalProperties: false } }, { type: 'null' }] },
      explanation: { maxLength: 350 },
    },
  });
  expect(declaration.parameters.required).toEqual(['outcome', 'explanation']);
  const output = restoreOptionalFields(
    {
      outcome: 'no-route',
      explanation: 'No supported route.',
      destinationId: null,
      origin: null,
      destination: null,
      steps: null,
    },
    declaration.parameters,
  );
  expect(output).toEqual({ outcome: 'no-route', explanation: 'No supported route.' });
  expect(generatedRouteSchema.safeParse(output).success).toBe(true);
});

it('retains required nulls and unknown fields so application validation can reject them', () => {
  const declaration = routeTool(['SW3-F1-p1'], ['label']);
  const output = restoreOptionalFields(
    { outcome: null, explanation: null, injected: null },
    declaration.parameters,
  );
  expect(output).toEqual({ outcome: null, explanation: null, injected: null });
  expect(generatedRouteSchema.safeParse(output).success).toBe(false);
});

it('retries output-limit failures once with concise-output guidance and rejects partial actions', async () => {
  const tool = routeTool(['SW3-F1-p1'], ['label']);
  const metrics: ProviderMetric[] = [];
  const limited = {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'function_call', status: 'in_progress', name: tool.name, arguments: '{' }],
    usage: { output_tokens: 8192, output_tokens_details: { reasoning_tokens: 0 } },
  };
  const completed = {
    status: 'completed',
    output: [
      {
        type: 'function_call',
        status: 'completed',
        name: tool.name,
        arguments: JSON.stringify({
          outcome: 'no-route',
          explanation: 'No supported route.',
          destinationId: null,
          origin: null,
          destination: null,
          steps: null,
        }),
      },
    ],
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(limited))
    .mockResolvedValueOnce(Response.json(completed));
  const provider = new OpenAiProvider({
    apiKey: 'mock',
    model: 'gpt-6-luna',
    timeoutMs: 90000,
    requestsPerMinute: 6,
    requestsPerDay: 60,
    fetchImpl: fetcher,
    waitForRetry: async () => {},
    onMetric: (metric) => metrics.push(metric),
  });
  const result = await provider.generate([], [tool], undefined, undefined, {
    forceTool: tool.name,
    maxOutputTokens: 8192,
  });
  expect(result).toEqual([
    {
      functionCall: {
        name: tool.name,
        args: { outcome: 'no-route', explanation: 'No supported route.' },
      },
    },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const retry = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(retry.instructions).toContain('previous response exceeded its output limit');
  expect(retry.max_output_tokens).toBe(8192);
  expect(metrics[0]).toMatchObject({
    outcome: 'failure',
    code: 'response_limit',
    incompleteReason: 'max_output_tokens',
    outputTokens: 8192,
    reasoningTokens: 0,
  });
  expect(metrics[1].outcome).toBe('success');
});
