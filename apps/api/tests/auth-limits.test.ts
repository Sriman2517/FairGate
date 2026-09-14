import "dotenv/config";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const database = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" || database.port !== "5433" || database.pathname !== "/fairgate" ||
  redisUrl.protocol !== "redis:" || redisUrl.hostname !== "127.0.0.1" || redisUrl.port !== "6380" || !["", "/", "/0"].includes(redisUrl.pathname)) {
  throw new Error("Auth limit tests require the local FairGate PostgreSQL and Redis services.");
}
process.env.AUTH_LIMIT_NAMESPACE = `limits-test-${randomUUID()}`;
const { getRedis, closeRedis } = await import("../src/redis.js");
const { authLimitKeys, authLimits, enforceAuthLimit, AuthLimitExceeded } = await import("../src/auth/limits.js");

test("shared authentication limits and actual API dependency health", async (t) => {
  const children: ChildProcess[] = [];
  const sockets = new Set<Socket>();
  const silentRedis = createServer((socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.resume(); });
  const emails = Array.from({ length: 4 }, () => `missing-${randomUUID()}@fairgate.test`);
  const password = "synthetic invalid passphrase";
  async function startServer(redisOverride?: string) {
    const child = fork(fileURLToPath(new URL("./helpers/booking-server.ts", import.meta.url)), {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, ...(redisOverride ? { REDIS_URL: redisOverride } : {}) },
    });
    children.push(child); child.stderr?.resume();
    return new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, port?: number) => {
        clearTimeout(timer); child.off("error", onError); child.off("exit", onExit); child.off("message", onMessage);
        if (error) { child.kill(); reject(error); } else resolve(`http://127.0.0.1:${port}`);
      };
      const onError = (error: Error) => finish(error);
      const onExit = () => finish(new Error("Auth limit test API exited before listening."));
      const onMessage = (message: unknown) => {
        if (message && typeof message === "object" && "port" in message && typeof message.port === "number") finish(undefined, message.port);
      };
      const timer = setTimeout(() => finish(new Error("Auth limit test API startup timed out.")), 30000);
      child.once("error", onError); child.once("exit", onExit); child.on("message", onMessage);
    });
  }
  async function stopServer(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill(), 5000);
      const deadline = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000);
      child.once("exit", () => { clearTimeout(timer); clearTimeout(deadline); resolve(); });
      if (child.connected) child.send("shutdown", (error) => { if (error) child.kill(); }); else child.kill();
    });
  }


  function login(base: string, email: string, headers: Record<string, string> = {}) {
    return fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000) });
  }
  async function limited(response: Response) {
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "TOO_MANY_ATTEMPTS");
    assert.ok(Number(response.headers.get("retry-after")) > 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  try {
    const redis = await getRedis();
    const servers = await Promise.all([startServer(), startServer()]);
    await t.test("healthy readiness checks both services while liveness checks the process", async () => {
      for (const base of servers) {
        const live = await fetch(`${base}/health`); assert.equal(live.status, 200); await live.text();
        const ready = await fetch(`${base}/ready`); assert.equal(ready.status, 200);
        assert.deepEqual(await ready.json(), { status: "ready", dependencies: { database: "up", redis: "up" } });
        assert.equal(ready.headers.get("cache-control"), "no-store");
        assert.equal(ready.headers.has("x-powered-by"), false);
      }
    });
    await t.test("simultaneous attempts across two API processes consume one normalized-email allowance", async () => {
      const responses = await Promise.all(Array.from({ length: 14 }, (_, i) => login(servers[i % 2], i % 2 ? ` ${emails[0].toUpperCase()} ` : emails[0])));
      assert.equal(responses.filter((response) => response.status === 401).length, 10);
      for (const response of responses) {
        if (response.status === 401) assert.equal((await response.json()).error.code, "INVALID_CREDENTIALS");
        else await limited(response);
      }
      assert.equal(await redis.get(authLimitKeys("login", emails[0])[1]), "10");
    });
    await t.test("a fresh process and spoofed forwarding headers cannot reset the email budget; other emails remain independent", async () => {
      const fresh = await startServer();
      await limited(await login(fresh, emails[0], { "X-Forwarded-For": "198.51.100.2", "X-Real-IP": "198.51.100.3" }));
      const different = await login(fresh, emails[1]); assert.equal(different.status, 401); await different.text();
      assert.equal(authLimitKeys("login", emails[0])[1].includes(emails[0]), false);
    });
    await t.test("denials preserve expiration, and registration has a separate finite allowance", async () => {
      const key = authLimitKeys("login", emails[0])[1];
      const expires = await redis.sendCommand(["PEXPIRETIME", key]);
      await limited(await login(servers[0], emails[0]));
      assert.equal(await redis.sendCommand(["PEXPIRETIME", key]), expires);
      for (let i = 0; i < authLimits.register; i++) await enforceAuthLimit("register", emails[0]);
      await assert.rejects(enforceAuthLimit("register", emails[0]), AuthLimitExceeded);
      assert.ok((await redis.pTTL(key)) > 0);
      // Expire only this test-owned email counter; the next call gets a new window.
      await redis.pExpire(key, 0);
      const fresh = await login(servers[0], emails[0]); assert.equal(fresh.status, 401); await fresh.text();
      assert.equal(await redis.get(key), "1");
    });
    await t.test("the service budget blocks new password work without creating arbitrary email keys", async () => {
      const [service, account] = authLimitKeys("login", emails[2]);
      await redis.set(service, String(authLimits.service), { PX: 60000 });
      await limited(await login(servers[1], emails[2]));
      assert.equal(await redis.exists(account), 0);
      assert.equal(await redis.get(service), String(authLimits.service));
      await redis.del(service);
    });
    await t.test("Redis silence fails new authentication closed, reports not-ready, and keeps liveness and logout available", async () => {
      silentRedis.listen(0, "127.0.0.1"); await once(silentRedis, "listening");
      const address = silentRedis.address(); assert.ok(address && typeof address !== "string");
      const base = await startServer(`redis://127.0.0.1:${address.port}`);
      const denied = await login(base, emails[3]); assert.equal(denied.status, 503);
      assert.deepEqual(await denied.json(), { error: { code: "AUTH_UNAVAILABLE", message: "Sign-in is temporarily unavailable. Please try again shortly." } });
      const live = await fetch(`${base}/health`); assert.equal(live.status, 200); await live.text();
      const ready = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(5000) }); assert.equal(ready.status, 503);
      assert.equal((await ready.json()).dependencies.redis, "down");
      const logout = await fetch(`${base}/auth/logout`, { method: "POST" }); assert.equal(logout.status, 204);
    });
  } finally {
    await Promise.allSettled(children.map(stopServer));
    for (const socket of sockets) socket.destroy();
    if (silentRedis.listening) await new Promise<void>((resolve) => silentRedis.close(() => resolve()));
    try { await (await getRedis()).del([...new Set(emails.flatMap((email) => [...authLimitKeys("login", email), ...authLimitKeys("register", email)]))]); }
    finally { await closeRedis(); }
  }
});
