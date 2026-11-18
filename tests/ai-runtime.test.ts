/** Deadline, streaming, retry and redacted telemetry regressions using controlled transport. */
import { afterEach, expect, it, vi } from 'vitest';
import { OpenAiProvider } from '../server/openai-provider';
import { GeminiProvider } from '../server/provider';
import { readOpenAiResponse } from '../server/openai-stream';
import { stageDeadline } from '../server/provider-timing';
import type { ProviderMetric } from '../server/provider-metrics';

const settings = {
  apiKey: 'private-test-key',
  model: 'gpt-6-luna',
  requestsPerMinute: 6,
  requestsPerDay: 60,
  timeoutMs: 15000,
};
const completed = {
  status: 'completed',
  output: [
    {
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Ready' }],
    },
  ],
  usage: {
    input_tokens: 40,
    input_tokens_details: { cached_tokens: 12 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 3 },
  },
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fakeDeadlines() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Deadline', 'TimeoutError')), ms);
    return controller.signal;
  });
}
const pause = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

it('lets a healthy 31-second request complete within the 90-second comparison budget', async () => {
  fakeDeadlines();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    await pause(31000, init?.signal);
    return Response.json(completed);
  });
  const provider = new OpenAiProvider({ ...settings, fetchImpl: fetcher });
  const stage = stageDeadline(90000);
  const result = expect(
    provider.generate([], [], stage.signal, undefined, { deadlineAt: stage.deadlineAt }),
  ).resolves.toEqual([{ text: 'Ready' }]);
  await vi.advanceTimersByTimeAsync(31001);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('gives the next comparison call only the time remaining in the same stage', async () => {
  fakeDeadlines();
  const stage = stageDeadline(90000);
  await vi.advanceTimersByTimeAsync(70000);
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    await pause(25000, init?.signal);
    return Response.json(completed);
  });
  const provider = new OpenAiProvider({ ...settings, fetchImpl: fetcher });
  const result = expect(
    provider.generate([], [], stage.signal, undefined, { deadlineAt: stage.deadlineAt }),
  ).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(20001);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('retries a connection failure once, records both attempts and honors a shared budget', async () => {
  const metric = vi.fn();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('private upstream detail'))
    .mockResolvedValueOnce(Response.json(completed));
  const budget = vi.fn(async () => {});
  const provider = new OpenAiProvider({
    ...settings,
    fetchImpl: fetcher,
    onMetric: metric,
    reserveSharedBudget: budget,
    waitForRetry: async () => {},
  });
  expect(await provider.generate([], [])).toEqual([{ text: 'Ready' }]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(budget).toHaveBeenCalledTimes(2);
  expect(metric.mock.calls.map(([event]) => event.outcome)).toEqual(['failure', 'success']);
  expect(JSON.stringify(metric.mock.calls)).not.toMatch(/private-test-key|private upstream detail/);
});

it('honors a short Retry-After and refuses a retry that cannot fit the deadline', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
    .mockResolvedValueOnce(Response.json(completed));
  const wait = vi.fn(async (_milliseconds: number, _signal?: AbortSignal) => {});
  await new OpenAiProvider({ ...settings, fetchImpl: fetcher, waitForRetry: wait }).generate(
    [],
    [],
  );
  expect(wait.mock.calls[0][0]).toBe(2000);
  const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
  await expect(
    new OpenAiProvider({ ...settings, fetchImpl: unavailable }).generate(
      [],
      [],
      undefined,
      undefined,
      { deadlineAt: Date.now() + 500 },
    ),
  ).rejects.toMatchObject({ code: 'unavailable' });
  expect(unavailable).toHaveBeenCalledTimes(1);
});

function eventStream(events: unknown[], headers: Record<string, string> = {}) {
  const encoded = new TextEncoder().encode(
    events.map((event) => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join(''),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        // Split through UTF-8 and SSE framing to exercise incremental decoding.
        for (let offset = 0; offset < encoded.length; offset += 7)
          controller.enqueue(encoded.slice(offset, offset + 7));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', ...headers } },
  );
}

it('collects first-event/output timing and usage while applying only a completed response', async () => {
  const metrics: ProviderMetric[] = [];
  const response = eventStream(
    [
      { type: 'response.created', response: { status: 'in_progress' } },
      { type: 'response.output_text.delta', delta: '준비' },
      { type: 'response.completed', response: completed },
    ],
    { 'x-request-id': 'req_test123' },
  );
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const provider = new OpenAiProvider({
    ...settings,
    fetchImpl: fetcher,
    onMetric: (event) => metrics.push(event),
  });
  expect(
    await provider.generate([{ role: 'user', parts: [{ text: 'private photo label' }] }], []),
  ).toEqual([{ text: 'Ready' }]);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).stream).toBe(true);
  expect(metrics[0]).toMatchObject({
    outcome: 'success',
    requestId: 'req_test123',
    firstEventMs: expect.any(Number),
    firstOutputMs: expect.any(Number),
    inputTokens: 40,
    outputTokens: 7,
    cachedInputTokens: 12,
    reasoningTokens: 3,
  });
  expect(JSON.stringify(metrics)).not.toMatch(/private photo label|private-test-key|준비|Ready/);
});

it('rejects an interrupted stream and incomplete terminal output', async () => {
  await expect(
    readOpenAiResponse(
      eventStream([{ type: 'response.function_call_arguments.delta', delta: '{"partial":' }]),
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'response' });
  const provider = new OpenAiProvider({
    ...settings,
    fetchImpl: async () =>
      eventStream([
        {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
          },
        },
      ]),
  });
  await expect(provider.generate([], [])).rejects.toMatchObject({ code: 'response_limit' });
});

it('cancels a started SSE response at the shared deadline and records failure timing', async () => {
  fakeDeadlines();
  const metrics: ProviderMetric[] = [];
  const fetcher: typeof fetch = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
          init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), {
            once: true,
          });
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  const stage = stageDeadline(90000);
  const provider = new OpenAiProvider({
    ...settings,
    fetchImpl: fetcher,
    onMetric: (event) => metrics.push(event),
  });
  const result = expect(
    provider.generate([], [], stage.signal, undefined, { deadlineAt: stage.deadlineAt }),
  ).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(90001);
  await result;
  expect(metrics).toHaveLength(1);
  expect(metrics[0]).toMatchObject({
    outcome: 'failure',
    code: 'timeout',
    firstEventMs: expect.any(Number),
  });
  expect(metrics[0].firstOutputMs).toBeUndefined();
});

it('records Gemini success usage with source bytes omitted', async () => {
  const metric = vi.fn();
  const provider = new GeminiProvider({
    ...settings,
    model: 'gemini-3.5-flash-lite',
    onMetric: metric,
    fetchImpl: async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: 'Ready' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 1 },
      }),
  });
  await provider.generate([], []);
  expect(metric.mock.calls[0][0]).toMatchObject({
    provider: 'gemini',
    outcome: 'success',
    inputTokens: 10,
    outputTokens: 2,
    reasoningTokens: 1,
  });
});
