import type { Server } from "node:http";

export const lifecycle = { draining: false };

// Stop accepting connections, finish active responses, then close data clients.
// The caller exits nonzero if this deadline or any cleanup fails.
export function createShutdown(server: Server, closeResources: (() => Promise<unknown>)[],
  onDrain: () => void, timeoutMs = 10_000) {
  let stopping: Promise<boolean> | undefined;
  // A response that was active when close() ran can become an idle keep-alive
  // connection afterward. Reap it only after Node finishes its response bookkeeping.
  server.on("request", (_request, response) => {
    response.once("finish", () => {
      if (stopping) setImmediate(() => server.closeIdleConnections());
    });
  });
  return function shutdown(): Promise<boolean> {
    if (stopping) return stopping;
    onDrain();
    stopping = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { server.closeAllConnections(); resolve(false); }, timeoutMs);
      server.close(async (error) => {
        try {
          const results = await Promise.allSettled(closeResources.map((close) => Promise.resolve().then(close)));
          resolve(!error && results.every((result) => result.status === "fulfilled"));
        } finally { clearTimeout(timer); }
      });
      server.closeIdleConnections();
    });
    return stopping;
  };
}
