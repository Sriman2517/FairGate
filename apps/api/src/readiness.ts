import type { RequestHandler } from "express";

// Share an in-flight probe so concurrent health checks cannot fill the DB pool.
export function createReadiness(checks: { database: () => Promise<unknown>; redis: () => Promise<unknown> },
  isDraining: () => boolean, timeoutMs = 3000): RequestHandler {
  let probe: Promise<{ database: string; redis: string }> | undefined;
  return async (_request, response) => {
    response.set("Cache-Control", "no-store");
    if (isDraining()) { response.status(503).json({ status: "draining" }); return; }
    probe ??= Promise.allSettled([Promise.resolve().then(checks.database), Promise.resolve().then(checks.redis)])
      .then(([database, redis]) => ({ database: database.status === "fulfilled" ? "up" : "down", redis: redis.status === "fulfilled" ? "up" : "down" }))
      .finally(() => { probe = undefined; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const dependencies = await Promise.race([
        probe,
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
      const ready = !isDraining() && dependencies?.database === "up" && dependencies.redis === "up";
      response.status(ready ? 200 : 503).json({ status: isDraining() ? "draining" : ready ? "ready" : "not_ready",
        dependencies: dependencies ?? { database: "unknown", redis: "unknown" } });
    } finally { clearTimeout(timer); }
  };
}
