import "dotenv/config";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const database = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" ||
  database.port !== "5433" || database.pathname !== "/fairgate" || redisUrl.protocol !== "redis:" ||
  redisUrl.hostname !== "127.0.0.1" || redisUrl.port !== "6380" || !["", "/", "/0"].includes(redisUrl.pathname)) {
  throw new Error("Waiting-room tests require local PostgreSQL at 127.0.0.1:5433/fairgate and Redis at 127.0.0.1:6380/0.");
}
const { prisma } = await import("../src/db.js");
const { getRedis, closeRedis } = await import("../src/redis.js");
const { waitingRoomKeys } = await import("../src/waiting-room.js");
const { requestLimitKey } = await import("../src/request-limits.js");

test("shared rolling request limits", async (t) => {
  const runId = randomUUID();
  const movieId = `limits-${runId}`;
  const showIds = [`limit-main-${runId}`, `limit-other-${runId}`];
  const [mainShow, otherShow] = showIds;
  const users = Array.from({ length: 4 }, (_unused, i) => ({ id: randomUUID(), email: `limits-${i}-${runId}@fairgate.test`,
    token: randomBytes(32).toString("base64url") }));
  const alternateToken = randomBytes(32).toString("base64url");
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
      const onExit = () => finish(new Error("Queue test API exited before listening."));
      const onMessage = (message: unknown) => {
        if (message && typeof message === "object" && "port" in message && typeof message.port === "number") finish(undefined, message.port);
      };
      const timer = setTimeout(() => finish(new Error("Queue test API startup timed out.")), 30000);
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

  async function request(server: number, path: string, customer?: number, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (customer !== undefined && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${users[customer].token}`);
    const response = await fetch(`${servers[server]}${path}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json(), retryAfter: Number(response.headers.get("retry-after")) };
  }
  function room(customer: number, server = 0, join = false, showId = mainShow, headers = {}) {
    return request(server, `/waiting-room/${showId}${join ? "/join" : ""}`, customer, { method: join ? "POST" : "GET", headers });
  }
  function book(customer: number, requestId = randomUUID(), seatLabel = "A1", server = 0, showId = mainShow) {
    return request(server, "/bookings", customer, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, seatLabel, requestId }) });
  }
  function limited(result: Awaited<ReturnType<typeof request>>) {
    assert.equal(result.status, 429); assert.equal(result.body.error.code, "TOO_MANY_REQUESTS");
    assert.ok(Number.isInteger(result.retryAfter) && result.retryAfter >= 1 && result.retryAfter <= 60);
  }
  try {
    const tomorrow = new Date(Date.now() + 86400000);
    await prisma.$transaction([
      prisma.movie.create({ data: { id: movieId, title: "Rate limit fixture", synopsis: "Synthetic test", language: "English", durationMinutes: 100 } }),
      prisma.show.createMany({ data: showIds.map((id) => ({ id, movieId, cinemaName: "Test cinema", screenName: "Test screen", startsAt: tomorrow, priceInPaise: 30000 })) }),
      prisma.showSeat.createMany({ data: showIds.flatMap((showId) => [1, 2, 3, 4].map((number) => ({ showId, row: "A", number, label: `A${number}` }))) }),
      prisma.user.createMany({ data: users.map(({ id, email }) => ({ id, email, name: "Limit test", passwordHash: "synthetic-no-login" })) }),
      prisma.session.createMany({ data: [...users.map(({ id, token }) => ({ userId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: tomorrow })),
        { userId: users[0].id, tokenHash: createHash("sha256").update(alternateToken).digest("hex"), expiresAt: tomorrow }] }),
    ]);
    const redis = await getRedis();
    servers.push(...await Promise.all([startServer(), startServer()]));
    assert.notEqual(children[0].pid, children[1].pid);

    await t.test("80 concurrent queue calls share one 60-request allowance across two API processes", async () => {
      const results = await Promise.all(Array.from({ length: 80 }, (_unused, i) => room(0, i % 2, i % 3 === 0)));
      assert.equal(results.filter((result) => result.status === 200).length, 60);
      const denied = results.filter((result) => result.status !== 200);
      assert.equal(denied.length, 20); denied.forEach(limited);
      assert.equal(await redis.zCard(requestLimitKey(users[0].id, "waiting-room")), 60);
      assert.equal(await redis.zCard(waitingRoomKeys(mainShow)[1]), 1, "Repeated joins never duplicate admission.");
    });
    await t.test("session changes, show changes and spoofed IP headers cannot reset an account's budget", async () => {
      limited(await room(0, 1, false, otherShow, { Authorization: `Bearer ${alternateToken}`, "X-Forwarded-For": "198.51.100.77" }));
      limited(await room(0, 0, true, otherShow));
      // A fresh process uses the same Redis budget.
      servers.push(await startServer()); limited(await room(0, 2));
      assert.equal((await room(1, 1, true, otherShow)).status, 200, "Another account on the same backend IP has its own budget.");
      assert.equal(await redis.zScore(waitingRoomKeys(otherShow)[1], users[0].id), null);
    });
    await t.test("denied calls do not refresh the window and only expired entries free allowance", async () => {
      const key = requestLimitKey(users[0].id, "waiting-room");
      const entries = await redis.zRangeWithScores(key, 0, -1);
      const expiryBefore = Number(await redis.sendCommand(["PEXPIRETIME", key]));
      limited(await room(0));
      assert.equal(Number(await redis.sendCommand(["PEXPIRETIME", key])), expiryBefore);
      assert.equal(await redis.zCard(key), 60);
      // Move one owned fixture attempt outside the rolling window; the other 59 remain.
      await redis.zAdd(key, { value: entries[0].value, score: 0 });
      assert.equal((await room(0)).status, 200);
      limited(await room(0, 1));
      assert.equal(await redis.zCard(key), 60);
      assert.equal(await redis.zScore(key, entries[0].value), null);
      const ttl = await redis.pTTL(key); assert.ok(ttl > 0 && ttl <= 60000);
    });
    await t.test("queue allowance and booking allowance are separate; booking failures spend attempts", async () => {
      // Account 0 exhausted queue checks, but still has its admitted checkout turn.
      const result = await book(0);
      assert.equal(result.status, 201);
      assert.equal(await redis.zCard(requestLimitKey(users[0].id, "booking")), 1);
      const resultKey = randomUUID();
      const errors = await Promise.all(Array.from({ length: 25 }, (_unused, i) => book(2, i === 0 ? resultKey : randomUUID(), "A2", i % 2)));
      assert.equal(errors.filter((response) => response.status === 403 && response.body.error.code === "ADMISSION_REQUIRED").length, 20);
      const throttled = errors.filter((response) => response.status === 429);
      assert.equal(throttled.length, 5); throttled.forEach(limited);
      assert.equal(await prisma.booking.count({ where: { userId: users[2].id } }), 0);
      assert.equal(await redis.zCard(requestLimitKey(users[2].id, "booking")), 20);
      limited(await book(2, randomUUID(), "A1", 1, otherShow));
    });
    await t.test("completed booking retries recover without spending budget, even while Redis is unavailable", async () => {
      await room(3, 0, true, otherShow);
      const key = randomUUID();
      const created = await book(3, key, "A1", 0, otherShow); assert.equal(created.status, 201);
      // New intentions count even when the chosen seat is already booked.
      const attempts = await Promise.all(Array.from({ length: 19 }, () => book(3, randomUUID(), "A1", 1, otherShow)));
      assert.ok(attempts.every((result) => result.status === 409 && result.body.error.code === "SEAT_UNAVAILABLE"));
      limited(await book(3, randomUUID(), "A2", 1, otherShow));
      const replay = await book(3, key, "A1", 1, otherShow);
      assert.equal(replay.status, 200); assert.equal(replay.body.booking.id, created.body.booking.id);
      const changed = await book(3, key, "A2", 0, otherShow);
      assert.equal(changed.status, 409); assert.equal(changed.body.error.code, "REQUEST_ID_REUSED");
      assert.equal(await redis.zCard(requestLimitKey(users[3].id, "booking")), 20);
      assert.equal((await request(1, "/bookings", 3)).status, 200);
      await new Promise<void>((resolve) => silentRedis.listen(0, "127.0.0.1", resolve));
      const address = silentRedis.address(); assert.ok(address && typeof address !== "string");
      servers.push(await startServer(`redis://127.0.0.1:${address.port}`));
      const failing = servers.length - 1;
      assert.equal((await book(3, key, "A1", failing, otherShow)).status, 200);
      const unavailable = await book(3, randomUUID(), "A2", failing, otherShow);
      assert.equal(unavailable.status, 503); assert.equal(unavailable.body.error.code, "WAITING_ROOM_UNAVAILABLE");
      assert.equal(await prisma.booking.count({ where: { userId: users[3].id } }), 1);
    });
    await t.test("unauthenticated and malformed booking requests do not create account limit entries", async () => {
      const before = await redis.zCard(requestLimitKey(users[1].id, "booking"));
      const unsigned = await request(0, `/waiting-room/${mainShow}`); assert.equal(unsigned.status, 401);
      const malformed = await request(0, "/bookings", 1, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(malformed.status, 400);
      assert.equal(await redis.zCard(requestLimitKey(users[1].id, "booking")), before);
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
      await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
      await (await getRedis()).del([...showIds.flatMap(waitingRoomKeys),
        ...users.flatMap(({ id }) => [requestLimitKey(id, "waiting-room"), requestLimitKey(id, "booking")])]);
    } finally { await closeRedis(); await prisma.$disconnect(); }
  }
});
