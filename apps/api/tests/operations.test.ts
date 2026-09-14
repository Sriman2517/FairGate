import "dotenv/config";
import assert from "node:assert/strict";
import { execFile, fork, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const database = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" ||
  database.port !== "5433" || database.pathname !== "/fairgate" || redisUrl.protocol !== "redis:" ||
  redisUrl.hostname !== "127.0.0.1" || redisUrl.port !== "6380" || !["", "/", "/0"].includes(redisUrl.pathname)) {
  throw new Error("Operations tests require local PostgreSQL at 127.0.0.1:5433/fairgate and Redis at 127.0.0.1:6380/0.");
}
const { prisma } = await import("../src/db.js");
const { getRedis, closeRedis } = await import("../src/redis.js");
const { waitingRoomKeys } = await import("../src/waiting-room.js");
const { requestLimitKey } = await import("../src/request-limits.js");

import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
test("operator snapshots and authorization", async (t) => {
  const runId = randomUUID();
  const movieId = `operations-${runId}`;
  const showIds = [`ops-main-${runId}`, `ops-other-${runId}`, `ops-past-${runId}`];
  const [mainShow, otherShow, pastShow] = showIds;
  const users = Array.from({ length: 4 }, (_, i) => ({ id: randomUUID(), email: `ops-${i}-${runId}@fairgate.test`, token: randomBytes(32).toString("base64url") }));
  const signupEmail = `ops-signup-${runId}@fairgate.test`;
  const children: ChildProcess[] = [];
  const servers: string[] = [];
  const sockets = new Set<Socket>();
  const silentRedis = createServer((socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.resume(); });
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
      const onExit = () => finish(new Error("Operations test API exited before listening."));
      const onMessage = (message: unknown) => {
        if (message && typeof message === "object" && "port" in message && typeof message.port === "number") finish(undefined, message.port);
      };
      const timer = setTimeout(() => finish(new Error("Operations test API startup timed out.")), 30000);
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

  async function request(path = "/operations/shows", user?: number, server = 0, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (user !== undefined) headers.set("Authorization", `Bearer ${users[user].token}`);
    const response = await fetch(`${servers[server]}${path}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json() };
  }
  const roleCommand = (...args: string[]) => execFileAsync(process.execPath, ["--import", "tsx",
    fileURLToPath(new URL("../prisma/set-operator.ts", import.meta.url)), ...args], { env: process.env, timeout: 15000 });
  try {
    const tomorrow = new Date(Date.now() + 86400000);
    await prisma.$transaction([
      prisma.movie.create({ data: { id: movieId, title: "Operations fixture", synopsis: "Synthetic test", language: "English", durationMinutes: 100 } }),
      prisma.show.createMany({ data: showIds.map((id) => ({ id, movieId, cinemaName: "Test cinema", screenName: "Test screen",
        startsAt: id === pastShow ? new Date(Date.now() - 60000) : tomorrow, priceInPaise: 30000 })) }),
      prisma.showSeat.createMany({ data: showIds.flatMap((showId) => [1, 2, 3, 4].map((number) => ({ showId, row: "A", number, label: `A${number}` }))) }),
      prisma.user.createMany({ data: users.map(({ id, email }) => ({ id, email, name: "Operator test", passwordHash: "synthetic-no-login" })) }),
      prisma.session.createMany({ data: users.map(({ id, token }) => ({ userId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: tomorrow })) }),
    ]);
    const redis = await getRedis();
    servers.push(...await Promise.all([startServer(), startServer()]));

    await t.test("anonymous requests and forged customer roles cannot read operational data", async () => {
      assert.equal((await request()).status, 401);
      const denied = await request("/operations/shows?role=OPERATOR", 0, 0, { headers: { "X-Role": "OPERATOR" } });
      assert.equal(denied.status, 403); assert.equal(denied.body.error.code, "OPERATOR_REQUIRED");
      assert.equal(denied.body.shows, undefined);
      const signup = await request("/auth/register", undefined, 0, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Role injection test", email: signupEmail, password: `FairGate test passphrase ${runId}`, role: "OPERATOR" }) });
      assert.equal(signup.status, 201);
      const account = await prisma.user.findUniqueOrThrow({ where: { email: signupEmail } });
      assert.equal(account.role, "CUSTOMER");
      assert.deepEqual(Object.keys(signup.body.user).sort(), ["email", "id", "name"]);
    });
    await t.test("local CLI grants and revokes privileges for existing sessions across API processes", async () => {
      await roleCommand("--email", users[0].email.toUpperCase(), "--role", "OPERATOR");
      await roleCommand("--email", users[0].email, "--role", "OPERATOR");
      assert.equal((await request("/operations/shows", 0)).status, 200);
      assert.equal((await request("/operations/shows", 0, 1)).status, 200);
      await roleCommand("--email", users[0].email, "--role", "CUSTOMER");
      assert.equal((await request("/operations/shows", 0)).status, 403);
      assert.equal((await request("/operations/shows", 0, 1)).status, 403);
      await assert.rejects(roleCommand("--email", users[0].email, "--role", "ADMIN"));
      await assert.rejects(roleCommand("--email", `missing-${runId}@fairgate.test`, "--role", "OPERATOR"));
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: users[0].id } })).role, "CUSTOMER");
      await roleCommand("--email", users[0].email, "--role", "OPERATOR");
    });
    await t.test("seat counts reflect a real booking and queue counts are shared without exposing customers", async () => {
      for (const user of [1, 2, 3]) assert.equal((await request(`/waiting-room/${mainShow}/join`, user, user % 2, { method: "POST" })).status, 200);
      const booking = await request("/bookings", 1, 0, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId: mainShow, seatLabel: "A1", requestId: randomUUID() }) });
      assert.equal(booking.status, 201);
      for (const server of [0, 1]) {
        const result = await request("/operations/shows", 0, server);
        assert.equal(result.status, 200); assert.equal(result.body.queueStatus, "available");
        assert.ok(Number.isFinite(Date.parse(result.body.queueObservedAt)));
        const show = result.body.shows.find((show: { id: string }) => show.id === mainShow);
        assert.deepEqual([show.totalSeats, show.bookedSeats, show.availableSeats, show.waitingCustomers, show.activeTurns, show.checkoutCapacity], [4, 1, 3, 1, 2, 2]);
        const empty = result.body.shows.find((show: { id: string }) => show.id === otherShow);
        assert.deepEqual([empty.bookedSeats, empty.waitingCustomers, empty.activeTurns], [0, 0, 0]);
        assert.ok(!result.body.shows.some((show: { id: string }) => show.id === pastShow));
        const serialized = JSON.stringify(result.body);
        for (const user of users) for (const secret of [user.id, user.email, user.token]) assert.ok(!serialized.includes(secret));
        assert.ok(!serialized.includes(booking.body.booking.id));
      }
    });
    await t.test("refresh excludes expired members without pruning, promoting, renewing, or spending customer budget", async () => {
      const [waiting, active, leases, sequence] = waitingRoomKeys(mainShow);
      await redis.zAdd(active, { value: users[1].id, score: 0 });
      await redis.zAdd(waiting, { value: "expired-fixture-waiter", score: 999 });
      await redis.zAdd(leases, { value: "expired-fixture-waiter", score: 0 });
      const state = async () => ({
        waiting: await redis.zRangeWithScores(waiting, 0, -1), active: await redis.zRangeWithScores(active, 0, -1),
        leases: await redis.zRangeWithScores(leases, 0, -1), sequence: await redis.get(sequence),
        expiries: await Promise.all(waitingRoomKeys(mainShow).map((key) => redis.sendCommand(["PEXPIRETIME", key]))),
      });
      const before = await state();
      for (let i = 0; i < 3; i++) {
        const result = await request("/operations/shows", 0, i % 2);
        const show = result.body.shows.find((show: { id: string }) => show.id === mainShow);
        assert.deepEqual([show.waitingCustomers, show.activeTurns], [1, 1]);
      }
      assert.deepEqual(await state(), before);
      assert.equal(await redis.exists(requestLimitKey(users[0].id, "waiting-room")), 0);
    });
    await t.test("Redis failure preserves inventory with unknown counts, while role checks still reject customers", async () => {
      await new Promise<void>((resolve) => silentRedis.listen(0, "127.0.0.1", resolve));
      const address = silentRedis.address(); assert.ok(address && typeof address !== "string");
      servers.push(await startServer(`redis://127.0.0.1:${address.port}`));
      assert.equal((await request("/operations/shows", 1, 2)).status, 403);
      const result = await request("/operations/shows", 0, 2);
      assert.equal(result.status, 200); assert.equal(result.body.queueStatus, "unavailable");
      assert.equal(result.body.queueObservedAt, null);
      const show = result.body.shows.find((show: { id: string }) => show.id === mainShow);
      assert.deepEqual([show.totalSeats, show.bookedSeats, show.availableSeats, show.waitingCustomers, show.activeTurns], [4, 1, 3, null, null]);
    });
    await t.test("the snapshot is bounded to the next 50 shows in deterministic time order", async () => {
      const extra = Array.from({ length: 51 }, (_, i) => `ops-limit-${runId}-${String(i).padStart(2, "0")}`);
      showIds.push(...extra);
      await prisma.show.createMany({ data: extra.map((id, i) => ({ id, movieId, cinemaName: "Test cinema", screenName: "Test screen",
        startsAt: new Date(Date.now() + 3600000 + i * 1000), priceInPaise: 30000 })) });
      const result = await request("/operations/shows", 0);
      assert.equal(result.body.limit, 50); assert.equal(result.body.shows.length, 50); assert.equal(result.body.hasMore, true);
      const shows = result.body.shows as { id: string; startsAt: string }[];
      assert.deepEqual(shows, [...shows].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id)));
      assert.ok(!shows.some((show) => show.id === mainShow));
    });
  } finally {
    await Promise.allSettled(children.map(stopServer));
    for (const socket of sockets) socket.destroy();
    if (silentRedis.listening) await new Promise<void>((resolve) => silentRedis.close(() => resolve()));
    try {
      await prisma.booking.deleteMany({ where: { showId: { in: showIds } } });
      await prisma.showSeat.deleteMany({ where: { showId: { in: showIds } } });
      await prisma.show.deleteMany({ where: { id: { in: showIds } } });
      await prisma.movie.deleteMany({ where: { id: movieId } });
      await prisma.user.deleteMany({ where: { email: { in: [...users.map((user) => user.email), signupEmail] } } });
      await (await getRedis()).del([...showIds.flatMap(waitingRoomKeys), ...users.flatMap(({ id }) => [requestLimitKey(id, "waiting-room"), requestLimitKey(id, "booking")])]);
    } finally { await closeRedis(); await prisma.$disconnect(); }
  }
});