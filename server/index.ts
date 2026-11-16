import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import react from '@vitejs/plugin-react';
import { configuredApplication } from './configured-app';
import { root } from './data';
import { listenServer } from './runtime';
if (existsSync(`${root}/.env`)) process.loadEnvFile(`${root}/.env`);
const { app, setupNotice } = configuredApplication(process.env);
const liveAvailable = setupNotice === null;
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
    `DirectionallyUnchallenged is ready at http://${host}:${port} · ${liveAvailable ? 'Gemini configured' : 'Gemini setup required'}`,
  );
  if (setupNotice) console.log(`Gemini configuration: ${setupNotice}`);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    code === 'EADDRINUSE'
      ? `DirectionallyUnchallenged could not start: port ${port} is already in use. Stop the other instance or set a different PORT.`
      : `DirectionallyUnchallenged could not start: ${code ?? 'listener error'}.`,
  );
  await closeDevelopmentServer?.();
  process.exitCode = 1;
}
