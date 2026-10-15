import type { Server } from 'node:http';

/** Resolve only after the HTTP listener binds; reject occupied ports instead of claiming readiness. */
export function listenServer(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}
