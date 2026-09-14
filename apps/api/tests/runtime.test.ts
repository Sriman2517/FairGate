import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { readApiConfig } from "../src/config.js";
import { createShutdown } from "../src/lifecycle.js";
import { createReadiness } from "../src/readiness.js";

const local = { DATABASE_URL: "postgresql://fairgate:fairgate_dev@127.0.0.1:5433/fairgate" };
async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function withReadiness(handler: RequestHandler, run: (url: string) => Promise<void>) {
  const app = express(); app.get("/ready", handler);
  const server = createServer(app);
  try { await run(await listen(server)); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("runtime configuration validates ports, service URLs, namespace, and production requirements without exposing secrets", () => {
  assert.equal(readApiConfig(local).host, "127.0.0.1");
  assert.equal(readApiConfig(local).port, 4000);
  const production = { NODE_ENV: "production", DATABASE_URL: "postgresql://user:private-secret@db.internal/fairgate", REDIS_URL: "rediss://redis.internal:6380", PORT: "8080" };
  assert.equal(readApiConfig(production).host, "0.0.0.0");
  assert.equal(readApiConfig(production).port, 8080);
  for (const override of [{ PORT: "0" }, { PORT: "65536" }, { PORT: "4000abc" }, { HOST: "anything.invalid" },
    { REDIS_URL: "https://private-secret@redis.test" }, { DATABASE_URL: "bad-private-secret" }, { AUTH_LIMIT_NAMESPACE: "unsafe{namespace}" }]) {
    assert.throws(() => readApiConfig({ ...production, ...override }), (error: unknown) => error instanceof Error && !error.message.includes("private-secret"));
  }
  assert.throws(() => readApiConfig({ ...local, NODE_ENV: "production" }), /REDIS_URL/);
  assert.throws(() => readApiConfig({ ...local, NODE_ENV: "production", REDIS_URL: "redis://127.0.0.1:6380" }), /demo password/);
});

test("readiness requires both dependencies and never serializes dependency errors", async () => {
  let failed = false;
  await withReadiness(createReadiness({ database: async () => { if (failed) throw new Error("secret database password"); }, redis: async () => "PONG" }, () => false), async (url) => {
    const healthy = await fetch(`${url}/ready`);
    assert.equal(healthy.status, 200); assert.equal(healthy.headers.get("cache-control"), "no-store");
    assert.deepEqual(await healthy.json(), { status: "ready", dependencies: { database: "up", redis: "up" } });
    failed = true;
    const unhealthy = await fetch(`${url}/ready`);
    assert.equal(unhealthy.status, 503);
    assert.deepEqual(await unhealthy.json(), { status: "not_ready", dependencies: { database: "down", redis: "up" } });
  });
});

test("silent dependency probes time out and concurrent checks reuse the pending probe", async () => {
  let probes = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  try {
    await withReadiness(createReadiness({ database: () => { probes++; return held; }, redis: async () => "PONG" }, () => false, 25), async (url) => {
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(1000) });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { status: "not_ready", dependencies: { database: "unknown", redis: "unknown" } });
      }
      assert.equal(probes, 1);
    });
  } finally { release(); }
});

test("draining readiness refuses traffic without querying dependencies", async () => {
  const forbidden = async () => { assert.fail("A draining server must not probe services"); };
  await withReadiness(createReadiness({ database: forbidden, redis: forbidden }, () => true), async (url) => {
    const response = await fetch(`${url}/ready`); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "draining" });
  });
});

test("shutdown drains an active response before closing resources and handles repeated signals once", async () => {
  let response!: ServerResponse;
  let entered!: () => void;
  const arrival = new Promise<void>((resolve) => { entered = resolve; });
  let drained = false;
  let cleaned = 0;
  const server = createServer((_request, res) => { response = res; entered(); });
  const stop = createShutdown(server, [async () => { cleaned++; }], () => { drained = true; }, 2000);
  const url = await listen(server);
  const request = fetch(url).then((res) => res.text());
  await arrival;
  const stopping = stop();
  assert.equal(stop(), stopping); assert.equal(drained, true); assert.equal(cleaned, 0);
  response.end("completed");
  assert.equal(await request, "completed"); assert.equal(await stopping, true); assert.equal(cleaned, 1);
});

test("shutdown forces a stuck connection closed at its deadline", async () => {
  let entered!: () => void;
  const arrival = new Promise<void>((resolve) => { entered = resolve; });
  const server = createServer(() => entered());
  const request = fetch(await listen(server)).then(() => false, () => true);
  await arrival;
  const stop = createShutdown(server, [], () => {}, 30);
  assert.equal(await stop(), false);
  assert.equal(await request, true);
});

test("cleanup failures produce an unsuccessful shutdown while other resources are still closed", async () => {
  const server = createServer(); await listen(server);
  let secondClosed = false;
  const stop = createShutdown(server, [async () => { throw new Error("fixture failure"); }, async () => { secondClosed = true; }], () => {});
  assert.equal(await stop(), false); assert.equal(secondClosed, true);
});
