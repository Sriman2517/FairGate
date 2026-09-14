import assert from "node:assert/strict";
import { get } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import express, { Router, type ErrorRequestHandler, type Response } from "express";
import { logRouteGroup, requestLogging, type RequestLog } from "../src/request-logging.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function fixture(run: (context: { url: string; entries: RequestLog[]; unfinished: () => Response | undefined }) => Promise<void>, writer?: (entry: RequestLog) => void) {
  const entries: RequestLog[] = [];
  let unfinished: Response | undefined;
  const app = express();
  app.use(requestLogging(writer ?? ((entry) => entries.push(entry))));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/unfinished", (_request, response) => { unfinished = response; response.flushHeaders(); });
  const orders = Router();
  orders.get("/fail", () => { throw new Error("sensitive-error-password"); });
  orders.post("/:orderId", (_request, response) => response.json({ status: "ok" }));
  orders.get("/:orderId", async (_request, response) => { await delay(15); response.json({ status: "ok" }); });
  app.use("/orders", logRouteGroup("/orders"), express.json({ limit: "1kb" }), orders);
  const auth = Router();
  auth.post("/login", (_request, response) => response.status(401).json({ error: "Denied" }));
  app.use("/auth", logRouteGroup("/auth"), express.json({ limit: "1kb" }), auth);
  const onError: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error.status === 400 || error.status === 413 ? error.status : 500).json({ error: "Request failed" });
  };
  app.use(onError);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await run({ url: `http://127.0.0.1:${address.port}`, entries, unfinished: () => unfinished });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  await response.text();
  return response;
}

async function waitFor(condition: () => boolean) {
  const until = Date.now() + 3000;
  while (!condition() && Date.now() < until) await delay(5);
  assert.ok(condition(), "Expected the response lifecycle event to be recorded.");
}

test("a completed request has one structured record and matching response ID", async () => {
  await fixture(async ({ url, entries }) => {
    const response = await request(`${url}/orders/private-order`);
    assert.equal(response.status, 200);
    assert.equal(entries.length, 1, "finish followed by close must not duplicate a log.");
    const entry = entries[0];
    assert.match(entry.requestId, uuid); assert.equal(entry.requestId, response.headers.get("x-request-id"));
    assert.equal(entry.route, "/orders/:orderId"); assert.equal(entry.method, "GET");
    assert.equal(entry.statusCode, 200); assert.equal(entry.outcome, "completed");
    assert.ok(entry.durationMs >= 10 && Number.isFinite(entry.durationMs));
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
    assert.deepEqual(Object.keys(entry).sort(), ["durationMs", "event", "method", "outcome", "requestId", "route", "statusCode", "timestamp"]);
  });
});

test("headers, body, query, identity, and caller-supplied IDs never enter the log", async () => {
  await fixture(async ({ url, entries }) => {
    const secrets = ["private-order", "private-query", "private-token", "private-cookie", "private-password", "private-email", "private-id"];
    const response = await request(`${url}/orders/${secrets[0]}?token=${secrets[1]}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secrets[2]}`, Cookie: `session=${secrets[3]}`, "X-Request-ID": secrets[6] },
      body: JSON.stringify({ password: secrets[4], email: secrets[5], userId: secrets[0] }),
    });
    assert.match(response.headers.get("x-request-id")!, uuid);
    const serialized = JSON.stringify(entries);
    for (const secret of secrets) assert.ok(!serialized.includes(secret), "A sensitive fixture value appeared in the log.");
    assert.equal(entries[0].route, "/orders/:orderId");
  });
});

test("parser errors, unexpected errors, and unknown URLs retain safe labels and status codes", async () => {
  await fixture(async ({ url, entries }) => {
    const cases: { path: string; options?: RequestInit; status: number; route: string }[] = [
      { path: "/auth/login?email=private-email", options: { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"password":"private-password"' }, status: 400, route: "/auth/*" },
      { path: "/auth/login", options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "private-password".repeat(200) }) }, status: 413, route: "/auth/*" },
      { path: "/auth/login", options: { method: "POST" }, status: 401, route: "/auth/login" },
      { path: "/orders/fail", status: 500, route: "/orders/fail" },
      { path: "/private-email?token=private-query", status: 404, route: "unmatched" },
    ];
    for (const item of cases) {
      const response = await request(`${url}${item.path}`, item.options);
      const last = entries.at(-1)!;
      assert.equal(response.status, item.status); assert.equal(last.statusCode, item.status);
      assert.equal(last.route, item.route); assert.equal(last.requestId, response.headers.get("x-request-id"));
    }
    assert.equal(entries.length, cases.length);
    assert.ok(!/private-|sensitive-error/.test(JSON.stringify(entries)));
  });
});

test("parallel requests have distinct IDs and never exchange log records", async () => {
  await fixture(async ({ url, entries }) => {
    const responses = await Promise.all(Array.from({ length: 16 }, () => request(`${url}/health`, { headers: { "X-Request-ID": "same-client-id" } })));
    const ids = responses.map((response) => response.headers.get("x-request-id")!);
    ids.forEach((id) => assert.match(id, uuid));
    assert.equal(new Set(ids).size, 16); assert.equal(entries.length, 16);
    assert.deepEqual(new Set(entries.map((entry) => entry.requestId)), new Set(ids));
    assert.ok(entries.every((entry) => entry.route === "/health" && entry.statusCode === 200));
  });
});

test("an unfinished disconnected response records one aborted outcome without claiming a status", async () => {
  await fixture(async ({ url, entries, unfinished }) => {
    let requestId: string | undefined;
    await new Promise<void>((resolve, reject) => {
      const client = get(`${url}/unfinished`, (response) => {
        requestId = response.headers["x-request-id"] as string;
        response.destroy(); resolve();
      });
      client.once("error", reject);
      client.setTimeout(3000, () => client.destroy(new Error("Disconnect test timed out.")));
    });
    await waitFor(() => entries.length === 1);
    assert.equal(entries[0].requestId, requestId);
    assert.equal(entries[0].outcome, "aborted"); assert.equal(entries[0].statusCode, null);
    assert.equal(entries[0].route, "/unfinished");
    unfinished()?.end();
    await delay(10);
    assert.equal(entries.length, 1);
  });
});

test("a throwing log writer does not break response completion or later requests", async () => {
  let writes = 0;
  await fixture(async ({ url }) => {
    assert.equal((await request(`${url}/health`)).status, 200);
    assert.equal((await request(`${url}/health`)).status, 200);
    assert.equal(writes, 2);
  }, () => { writes++; throw new Error("Synthetic log sink failure"); });
});
