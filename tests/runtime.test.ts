import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { listenServer } from '../server/runtime';

const closeServer = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

describe('server readiness', () => {
  it('reports readiness only after the listener is bound', async () => {
    const server = createServer();
    await listenServer(server, 0, '127.0.0.1');
    try {
      expect(server.listening).toBe(true);
      expect(server.address()).not.toBeNull();
    } finally {
      await closeServer(server);
    }
  });

  it('rejects an occupied port without replacing the existing server', async () => {
    const existing = createServer();
    const duplicate = createServer();
    await listenServer(existing, 0, '127.0.0.1');
    try {
      const port = (existing.address() as { port: number }).port;
      await expect(listenServer(duplicate, port, '127.0.0.1')).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
      expect(duplicate.listening).toBe(false);
      expect(existing.listening).toBe(true);
    } finally {
      await closeServer(existing);
    }
  });
});
