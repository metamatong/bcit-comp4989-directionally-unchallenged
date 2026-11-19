/** Real visitor API + OpenAI adapter, mocked provider responses and source protocol fixtures. */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { configuredApplication } from '../server/configured-app';
import { OpenAiProvider } from '../server/openai-provider';
import type { Session } from '../src/types';
import { comparison, locationInput, labelReading, photoInput } from './photo-fixtures';

const servers: Server[] = [];
async function listen(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    get: (path: string) => fetch(origin + path).then((response) => response.json()),
    post: (path: string, body: unknown) =>
      fetch(origin + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

it.each(['gemini', 'openai'] as const)(
  'publishes %s readiness and consent recipient from server configuration only',
  async (provider) => {
    const { app, setupNotice } = configuredApplication({
      AI_PROVIDER: provider,
      ...(provider === 'openai'
        ? { OPENAI_API_KEY: 'private-openai' }
        : {
            GEMINI_API_KEY: 'private-gemini',
            AI_FREE_TIER_CONFIRMED: 'true',
          }),
    });
    expect(setupNotice).toBeNull();
    const client = await listen(app);
    const bootstrap = await client.get('/api/bootstrap');
    expect(bootstrap).toMatchObject({
      provider,
      liveAvailable: true,
      model: provider === 'openai' ? 'gpt-6-luna' : 'gemini-3.5-flash-lite',
    });
    expect(JSON.stringify(bootstrap)).not.toContain('private-');
    const session: Session = await (await client.post('/api/sessions', {})).json();
    expect(session.notice).toContain(provider === 'openai' ? 'OpenAI' : 'Google Gemini');
    expect(session.agentStatus).toBe(provider === 'openai' ? 'OpenAI · ready' : 'Gemini · ready');
    const reset: Session = await (
      await client.post(`/api/sessions/${session.id}/actions`, {
        revision: session.revision,
        requestId: randomUUID(),
        action: { type: 'reset' },
      })
    ).json();
    expect(reset.agentStatus).toBe(session.agentStatus);
  },
);

it('keeps OpenAI disabled without its key even with configured Gemini and rejects consented submissions', async () => {
  const { app } = configuredApplication({
    AI_PROVIDER: 'openai',
    GEMINI_API_KEY: 'private-gemini',
    AI_FREE_TIER_CONFIRMED: 'true',
  });
  const client = await listen(app);
  expect(await client.get('/api/bootstrap')).toMatchObject({
    provider: 'openai',
    liveAvailable: false,
  });
  const session: Session = await (await client.post('/api/sessions', {})).json();
  const response = await client.post(`/api/sessions/${session.id}/photo/evidence`, photoInput());
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('OPENAI_API_KEY is missing');
});

it('uses OpenAI only for evidence extraction and resolves the start from source labels', async () => {
  const bodies: Record<string, any>[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const parts =
      body.tool_choice.name === 'read_photo_labels'
        ? labelReading('302', 'clear', 'SE12')
        : comparison();
    return Response.json({
      status: 'completed',
      output: parts.map((part) => ({
        type: 'function_call',
        status: 'completed',
        name: part.functionCall!.name,
        arguments: JSON.stringify(part.functionCall!.args),
      })),
    });
  });
  const provider = new OpenAiProvider({
    apiKey: 'private-openai',
    model: 'luna-6.0',
    requestsPerMinute: 6,
    requestsPerDay: 60,
    timeoutMs: 1000,
    fetchImpl: fetcher,
  });
  const client = await listen(createApp({ provider, liveAvailable: true, model: 'gpt-6-luna' }));
  const initial: Session = await (await client.post('/api/sessions', {})).json();
  expect(fetcher).not.toHaveBeenCalled();
  const input = photoInput();
  expect(
    (await client.post(`/api/sessions/${initial.id}/photo/evidence`, { ...input, consent: false }))
      .status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const observed: Session = await (
    await client.post(`/api/sessions/${initial.id}/photo/evidence`, input)
  ).json();
  expect(observed.photoEvidence?.labels[0].text).toBe('302');
  expect(observed.campusAnalysis).toBeNull();
  expect(observed.agentStatus).toContain('OpenAI');
  expect(
    bodies[0].input[0].content.filter((part: any) => part.type === 'input_image'),
  ).toHaveLength(5);
  expect(JSON.stringify(bodies[0])).not.toContain('SE12-F3-p1');
  const request = locationInput(observed.photoEvidence!.id, observed.revision);
  const response = await client.post(`/api/sessions/${initial.id}/photo`, request);
  expect(response.status).toBe(200);
  const result: Session = await response.json();
  expect(result.campusAnalysis).toMatchObject({
    method: 'photo-label-retrieval',
    labelRetrieval: { exactMatchPlanIds: ['NE1-F3-p1', 'SE2-F3-p1', 'SE12-F3-p1'] },
  });
  expect(result.campusAnalysis?.candidates[0]).toMatchObject({
    planId: 'SE12-F3-p1',
    verification: 'unverified-ai-hypothesis',
  });
  expect(result.campusLocation).toEqual(result.campusAnalysis?.candidates[0]);
  expect(result.providerCalls).toBe(1);
  expect(result.photoEvidence?.id).toBe(observed.photoEvidence!.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(bodies.every((body) => body.store === false && body.model === 'gpt-6-luna')).toBe(true);
  expect(bodies).toHaveLength(1);
  const stored = await client.get(`/api/sessions/${initial.id}`);
  expect(JSON.stringify(stored)).not.toContain(input.image.data);
  expect(JSON.stringify(stored)).not.toContain('private-openai');
});
