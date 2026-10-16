import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import react from '@vitejs/plugin-react';
import { GeminiProvider, liveAiFallbackModels, liveAiSetupIssue } from './provider';
import { createApp } from './app';
import { root } from './data';
import { listenServer } from './runtime';
if (existsSync(`${root}/.env`)) process.loadEnvFile(`${root}/.env`);
const bounded = (value: string | undefined, fallback: number, max: number) =>
  Math.max(1, Math.min(max, Number(value) || fallback));
const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
const fallbackModels = liveAiFallbackModels(process.env);
const setupNotice = liveAiSetupIssue(process.env);
const liveAvailable = setupNotice === null;
const provider = new GeminiProvider({
  apiKey: liveAvailable ? process.env.GEMINI_API_KEY! : '',
  model,
  fallbackModels,
  requestsPerMinute: bounded(process.env.AI_REQUESTS_PER_MINUTE, 6, 20),
  requestsPerDay: bounded(process.env.AI_REQUESTS_PER_DAY, 60, 1000),
  timeoutMs: bounded(process.env.AI_TIMEOUT_MS, 15000, 20000),
});
const app = createApp({ provider, liveAvailable, model, setupNotice });
const httpServer = createHttpServer(app);
let closeDevelopmentServer: (() => Promise<void>) | undefined;
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(`${root}/dist`));
  app.get('/{*path}', (_req, res) => res.sendFile(`${root}/dist/index.html`));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false,
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  closeDevelopmentServer = () => vite.close();
}
const port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST ?? '127.0.0.1';
try {
  await listenServer(httpServer, port, host);
  console.log(
    `CampusLens is ready at http://${host}:${port} · ${liveAvailable ? 'Gemini configured' : 'Gemini setup required'}`,
  );
  if (setupNotice) console.log(`Gemini configuration: ${setupNotice}`);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    code === 'EADDRINUSE'
      ? `CampusLens could not start: port ${port} is already in use. Stop the other instance or set a different PORT.`
      : `CampusLens could not start: ${code ?? 'listener error'}.`,
  );
  await closeDevelopmentServer?.();
  process.exitCode = 1;
}
