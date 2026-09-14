import { parseArgs } from "node:util";

export interface Sample { phase: "join" | "seat-race" | "replay"; status: number | null; durationMs: number }

export function readTrafficOptions(args: string[]) {
  const { values } = parseArgs({ args, options: { customers: { type: "string", default: "100" }, concurrency: { type: "string", default: "20" } }, allowPositionals: false });
  function integer(value: string | undefined, name: string, min: number, max: number) {
    if (!value || !/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return Number(value);
  }
  return { customers: integer(values.customers, "customers", 3, 200), joinConcurrency: integer(values.concurrency, "concurrency", 1, 50) };
}

export function requireLocalServices(databaseValue: string | undefined, redisValue: string | undefined) {
  const database = new URL(databaseValue ?? "http://missing.invalid");
  const redis = new URL(redisValue ?? "redis://127.0.0.1:6380");
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" ||
    database.search !== "" || database.port !== "5433" || database.pathname !== "/fairgate" || redis.protocol !== "redis:" ||
    redis.search !== "" || redis.hostname !== "127.0.0.1" || redis.port !== "6380" || !["", "/", "/0"].includes(redis.pathname)) {
    throw new Error("Traffic simulation requires PostgreSQL at 127.0.0.1:5433/fairgate and Redis at 127.0.0.1:6380/0.");
  }
}

export function summarize(samples: Sample[], elapsedMs: number) {
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (fraction: number) => durations.length ? durations[Math.ceil(durations.length * fraction) - 1] : null;
  const statuses: Record<string, number> = {};
  for (const sample of samples) { const key = sample.status === null ? "transport-error" : String(sample.status); statuses[key] = (statuses[key] ?? 0) + 1; }
  return { requests: samples.length, elapsedMs, completedRequestsPerSecond: elapsedMs > 0 ? samples.length * 1000 / elapsedMs : null,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: durations.at(-1) ?? null }, statuses };
}

// Drain already-started work before throwing, so cleanup cannot race an HTTP write.
export async function concurrentMap<T>(count: number, concurrency: number, action: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(count);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (!failed && next < count) {
      const index = next++;
      try { results[index] = await action(index); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
  return results;
}