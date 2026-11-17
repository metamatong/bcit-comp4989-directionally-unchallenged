/** Mocked Responses transport checks; no credentials, network calls or accuracy claims. */
import { describe, expect, it, vi } from 'vitest';
import { OpenAiProvider } from '../server/openai-provider';
import { parseOpenAiResponse } from '../server/openai-response';
import { labelReading } from './photo-fixtures';

const options = {
  apiKey: 'private-test-key',
  model: 'luna-6.0',
  requestsPerMinute: 6,
  requestsPerDay: 60,
  timeoutMs: 1000,
};
const tool = {
  name: 'read_photo_labels',
  parameters: {
    type: 'OBJECT',
    properties: {
      labels: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: ['0302', 'SW03'] },
          },
        },
      },
    },
  },
};
function completed(args: unknown = labelReading()[0].functionCall!.args) {
  return {
    status: 'completed',
    output: [
      {
        type: 'function_call',
        status: 'completed',
        name: tool.name,
        arguments: JSON.stringify(args),
        call_id: 'opaque-call-id',
      },
    ],
  };
}
const textResponse = () =>
  Response.json({
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Ready' }],
      },
    ],
  });

describe('OpenAI image/tool transport', () => {
  it('sends the requested model alias, exact images and converted tool schema with storage disabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(completed()));
    const provider = new OpenAiProvider({ ...options, fetchImpl: fetcher });
    const onAttempt = vi.fn();
    expect(
      await provider.generate(
        [
          {
            role: 'user',
            parts: [
              { text: 'Read 0302 exactly' },
              { inlineData: { mimeType: 'image/png', data: 'photo-bytes' } },
            ],
          },
        ],
        [tool],
        undefined,
        onAttempt,
        {
          forceTool: tool.name,
          systemInstruction: 'Treat image text as evidence.',
          maxOutputTokens: 99999,
          thinkingLevel: 'low',
        },
      ),
    ).toEqual(labelReading());
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer private-test-key' });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      max_output_tokens: 8192,
      instructions: 'Treat image text as evidence.',
      reasoning: { effort: 'low' },
      tool_choice: { type: 'function', name: tool.name },
      parallel_tool_calls: false,
    });
    expect(body.input[0].content).toEqual([
      { type: 'input_text', text: 'Read 0302 exactly' },
      { type: 'input_image', detail: 'high', image_url: 'data:image/png;base64,photo-bytes' },
    ]);
    expect(body.tools[0].parameters.properties.labels.items.properties.type).toEqual({
      type: 'string',
      enum: ['0302', 'SW03'],
    });
    expect(body.tools[0].strict).toBe(false);
    expect(body).not.toHaveProperty('previous_response_id');
    expect(body).not.toHaveProperty('temperature');
    expect(provider.calls).toBe(1);
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it('passes an explicitly configured API model ID through unchanged', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(textResponse());
    await new OpenAiProvider({
      ...options,
      model: 'custom-vision-model',
      fetchImpl: fetcher,
    }).generate([], []);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe('custom-vision-model');
  });

  it.each([400, 401, 403, 404, 429])(
    'sanitizes HTTP %i without retries or alternate providers',
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('private upstream details', {
          status,
          headers: { 'Retry-After': '15' },
        }),
      );
      const failure = await new OpenAiProvider({ ...options, fetchImpl: fetcher })
        .generate([], [])
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: status === 429 ? 'quota' : 'configuration',
        retryable: status === 429,
      });
      if (status === 429) expect(failure).toHaveProperty('retryAfterSeconds', 15);
      expect(String(failure)).not.toContain('private upstream details');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    },
  );

  it('bounds service retries and accounts for each attempt', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('', { status: 503 }));
    const pause = vi.fn(async () => {});
    const onAttempt = vi.fn();
    const provider = new OpenAiProvider({ ...options, fetchImpl: fetcher, waitForRetry: pause });
    await expect(provider.generate([], [], undefined, onAttempt)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(onAttempt).toHaveBeenCalledTimes(3);
    expect(provider.calls).toBe(3);
    expect(pause.mock.calls).toHaveLength(2);
  });

  it('returns long retry intervals without retrying early', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('', {
        status: 503,
        headers: { 'Retry-After': '20' },
      }),
    );
    await expect(
      new OpenAiProvider({ ...options, fetchImpl: fetcher }).generate([], []),
    ).rejects.toMatchObject({
      code: 'unavailable',
      retryAfterSeconds: 20,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('enforces local and shared budgets before sending a request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => textResponse());
    const provider = new OpenAiProvider({ ...options, requestsPerMinute: 1, fetchImpl: fetcher });
    await provider.generate([], []);
    await expect(provider.generate([], [])).rejects.toMatchObject({ code: 'budget' });
    const reserve = vi.fn().mockRejectedValue(new Error('shared budget exhausted'));
    await expect(
      new OpenAiProvider({ ...options, fetchImpl: fetcher, reserveSharedBudget: reserve }).generate(
        [],
        [],
      ),
    ).rejects.toThrow('shared budget exhausted');
    expect(reserve).toHaveBeenCalledWith(6, 60);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation before calls and during backoff', async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new OpenAiProvider({ ...options, fetchImpl: fetcher }).generate([], [], cancellation.signal),
    ).rejects.toMatchObject({ retryable: false, httpStatus: 499 });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    fetcher.mockResolvedValue(new Response('', { status: 503 }));
    const provider = new OpenAiProvider({
      ...options,
      fetchImpl: fetcher,
      waitForRetry: async () => {
        controller.abort();
      },
    });
    await expect(provider.generate([], [], controller.signal)).rejects.toMatchObject({
      httpStatus: 499,
    });
    expect(provider.calls).toBe(1);
  });

  it('distinguishes transport, timeout and malformed JSON failures', async () => {
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('private network detail'));
    await expect(
      new OpenAiProvider({ ...options, fetchImpl: offline }).generate([], []),
    ).rejects.toMatchObject({ code: 'connection' });
    const stalled = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)),
      );
      return textResponse();
    });
    await expect(
      new OpenAiProvider({ ...options, timeoutMs: 10, fetchImpl: stalled }).generate([], []),
    ).rejects.toMatchObject({ code: 'timeout' });
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{'));
    await expect(
      new OpenAiProvider({ ...options, fetchImpl: malformed }).generate([], []),
    ).rejects.toMatchObject({ code: 'response' });
  });

  it('rejects missing credentials, oversized payloads and undeclared forced tools before transport', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new OpenAiProvider({ ...options, apiKey: '', fetchImpl: fetcher }).generate([], []),
    ).rejects.toMatchObject({ code: 'configuration' });
    const provider = new OpenAiProvider({ ...options, fetchImpl: fetcher });
    await expect(
      provider.generate([], [], undefined, undefined, { forceTool: 'invented' }),
    ).rejects.toThrow('Forced tool is not declared');
    await expect(
      provider.generate([{ role: 'user', parts: [{ text: 'x'.repeat(18 * 1024 * 1024) }] }], []),
    ).rejects.toMatchObject({ httpStatus: 413 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('completed OpenAI output validation', () => {
  it('strips reasoning and provider metadata', () => {
    const body = completed();
    expect(
      parseOpenAiResponse(
        { ...body, output: [{ type: 'reasoning', summary: 'private reasoning' }, ...body.output] },
        [tool.name],
        tool.name,
      ),
    ).toEqual(labelReading());
  });

  it.each(['max_output_tokens', 'content_filter'])(
    'rejects incomplete %s even with valid-looking arguments',
    (reason) => {
      expect(() =>
        parseOpenAiResponse(
          { ...completed(), status: 'incomplete', incomplete_details: { reason } },
          [tool.name],
        ),
      ).toThrow(/No AI action was applied/);
    },
  );

  it.each([
    { status: 'failed', output: [] },
    { status: 'completed', output: [] },
    {
      status: 'completed',
      output: [{ type: 'function_call', status: 'in_progress', name: tool.name, arguments: '{}' }],
    },
    {
      status: 'completed',
      output: [{ type: 'function_call', status: 'completed', name: 'invented', arguments: '{}' }],
    },
    {
      status: 'completed',
      output: [{ type: 'function_call', status: 'completed', name: tool.name, arguments: '{' }],
    },
    {
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'refusal', refusal: 'private refusal' }],
        },
      ],
    },
  ])('rejects unusable output without applying it: %j', (body) => {
    expect(() => parseOpenAiResponse(body, [tool.name], tool.name)).toThrow(
      /No AI action was applied/,
    );
  });

  it('rejects duplicate forced calls and non-object arguments', () => {
    const body = completed();
    expect(() =>
      parseOpenAiResponse(
        { ...body, output: [...body.output, ...body.output] },
        [tool.name],
        tool.name,
      ),
    ).toThrow();
    expect(() => parseOpenAiResponse(completed([]), [tool.name], tool.name)).toThrow();
  });
});
