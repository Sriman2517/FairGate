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

test("shared FIFO waiting room and enforced checkout admission", async (t) => {
  const runId = randomUUID();
  const movieId = `queue-test-${runId}`;
  const showIds = ["order", "race", "other", "past", "empty", "limit", "booking", "leave", "leave-race", "leave-booking"].map((name) => `${name}-${runId}`);
  const [orderShow, raceShow, otherShow, pastShow, emptyShow, limitShow, bookingShow, leaveShow, leaveRaceShow, leaveBookingShow] = showIds;
  const users = Array.from({ length: 30 }, (_unused, index) => ({
    id: randomUUID(), email: `queue-${index}-${runId}@fairgate.test`, token: randomBytes(32).toString("base64url"),
  }));
  const children: ChildProcess[] = [];
  const servers: string[] = [];
  const sockets = new Set<Socket>();
  // A private failing Redis substitute; never pause or corrupt the shared service.
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
    if (customer !== undefined) headers.set("Authorization", `Bearer ${users[customer].token}`);
    const response = await fetch(`${servers[server]}${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json(), retryAfter: response.headers.get("retry-after") };
  }
  function room(customer: number, showId = orderShow, join = false, server = customer % 2) {
    return request(server, `/waiting-room/${showId}${join ? "/join" : ""}`, customer, { method: join ? "POST" : "GET" });
  }
  function leave(customer: number, showId = leaveShow, server = customer % 2) {
    return request(server, `/waiting-room/${showId}/leave`, customer, { method: "POST" });
  }
  function book(customer: number, showId: string, requestId = randomUUID(), server = customer % 2, extras = {}) {
    return request(server, "/bookings", customer, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, seatLabel: "A1", requestId, ...extras }) });
  }
  function error(result: Awaited<ReturnType<typeof request>>, status: number, code: string) {
    assert.equal(result.status, status); assert.equal(result.body.error.code, code);
  }

  try {
    const tomorrow = new Date(Date.now() + 86400000);
    await prisma.$transaction([
      prisma.movie.create({ data: { id: movieId, title: "Waiting-room test", synopsis: "Synthetic fixture", language: "English", durationMinutes: 100 } }),
      prisma.show.createMany({ data: showIds.map((id) => ({ id, movieId, cinemaName: "Test cinema", screenName: "Test screen",
        startsAt: id === pastShow ? new Date(Date.now() - 60000) : tomorrow, priceInPaise: 30000 })) }),
      prisma.showSeat.createMany({ data: showIds.filter((id) => id !== emptyShow).flatMap((showId) => [1, 2].map((number) => ({
        showId, label: `A${number}`, row: "A", number,
      }))) }),
      // Sessions are the fixture's auth boundary; these accounts cannot log in with a password.
      prisma.user.createMany({ data: users.map(({ id, email }) => ({ id, email, name: "Queue test", passwordHash: "synthetic-no-password-login" })) }),
      prisma.session.createMany({ data: users.map(({ id, token }) => ({ userId: id,
        tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: tomorrow })) }),
    ]);
    const redis = await getRedis();
    servers.push(...await Promise.all([startServer(), startServer()]));
    assert.notEqual(children[0].pid, children[1].pid);

    await t.test("authentication, show validity, and direct booking cannot be bypassed", async () => {
      error(await request(0, `/waiting-room/${orderShow}/join`, undefined, { method: "POST" }), 401, "UNAUTHENTICATED");
      error(await room(0, `missing-${runId}`, true), 404, "SHOW_NOT_FOUND");
      error(await room(0, pastShow, true), 409, "SHOW_STARTED");
      error(await room(0, emptyShow, true), 409, "SHOW_SOLD_OUT");
      assert.equal((await room(0)).body.waitingRoom.status, "not_joined");
      error(await book(0, orderShow, randomUUID(), 0, { admitted: true, userId: users[1].id }), 403, "ADMISSION_REQUIRED");
      assert.equal(await prisma.booking.count({ where: { showId: orderShow } }), 0);
    });
    await t.test("duplicate joins preserve account membership and fixed checkout expiry", async () => {
      const original = (await room(0, orderShow, true)).body.waitingRoom;
      assert.equal(original.status, "admitted"); assert.equal(original.position, null);
      const copies = await Promise.all([room(0, orderShow, true, 0), room(0, orderShow, true, 1), room(0)]);
      for (const copy of copies) assert.equal(copy.body.waitingRoom.expiresAt, original.expiresAt);
      assert.equal(await redis.zCard(waitingRoomKeys(orderShow)[1]), 1);
      assert.deepEqual(Object.keys(original).sort(), ["expiresAt", "pollAfterMs", "position", "serverTime", "status"]);
      assert.equal((await room(1, orderShow, true)).body.waitingRoom.status, "admitted");
    });
    await t.test("sequential waiters keep FIFO position across processes and duplicate joins", async () => {
      assert.equal((await room(2, orderShow, true)).body.waitingRoom.position, 1);
      assert.equal((await room(3, orderShow, true)).body.waitingRoom.position, 2);
      assert.equal((await room(3, orderShow, true, 0)).body.waitingRoom.position, 2);
      error(await book(3, orderShow), 403, "ADMISSION_REQUIRED");
      await redis.zAdd(waitingRoomKeys(orderShow)[1], { score: 0, value: users[0].id });
      // A newcomer triggers promotion, but the oldest waiter gets the freed turn.
      assert.equal((await room(4, orderShow, true)).body.waitingRoom.position, 2);
      assert.equal((await room(2)).body.waitingRoom.status, "admitted");
      assert.equal((await room(3)).body.waitingRoom.position, 1);
      assert.equal((await room(0)).body.waitingRoom.status, "not_joined");
      assert.equal((await room(0, orderShow, true)).body.waitingRoom.position, 3);
    });
    await t.test("abandoned waiters expire before heartbeat renewal and rejoin at the tail", async () => {
      const keys = waitingRoomKeys(orderShow);
      await redis.zAdd(keys[2], { score: 0, value: users[3].id });
      assert.equal((await room(3)).body.waitingRoom.status, "not_joined");
      assert.equal((await room(4)).body.waitingRoom.position, 1);
      assert.equal((await room(3, orderShow, true)).body.waitingRoom.position, 3);
      assert.equal(await redis.zScore(keys[2], users[2].id), null, "Admitted customers have no waiting heartbeat.");
      const expiries = await Promise.all(keys.map((key) => redis.pTTL(key)));
      assert.ok(expiries.every((ttl) => ttl > 0));
      assert.ok(Math.max(...expiries) - Math.min(...expiries) < 1000);
    });
    await t.test("30 simultaneous joins through two processes admit exactly two customers", async () => {
      const results = await Promise.all(users.map((_user, index) => room(index, raceShow, true)));
      assert.ok(results.every((result) => result.status === 200));
      assert.equal(results.filter((result) => result.body.waitingRoom.status === "admitted").length, 2);
      assert.equal(results.filter((result) => result.body.waitingRoom.status === "waiting").length, 28);
      const keys = waitingRoomKeys(raceShow);
      assert.equal(await redis.zCard(keys[1]), 2); assert.equal(await redis.zCard(keys[0]), 28);
      const queued = await redis.zRange(keys[0], 0, -1);
      const active = await redis.zRange(keys[1], 0, -1);
      await redis.zAdd(keys[1], active.map((value) => ({ value, score: 0 })));
      await room(29, raceShow);
      assert.deepEqual((await redis.zRange(keys[1], 0, -1)).sort(), queued.slice(0, 2).sort());
      assert.equal(await redis.zCard(keys[1]), 2);
    });
    await t.test("admission is scoped to the account and show, and survives API restart", async () => {
      assert.equal((await room(0, otherShow)).body.waitingRoom.status, "not_joined");
      error(await book(0, otherShow), 403, "ADMISSION_REQUIRED");
      const joined = await room(0, otherShow, true);
      assert.equal((await room(1, otherShow)).body.waitingRoom.status, "not_joined");
      servers.push(await startServer());
      const persisted = await room(0, otherShow, false, 2);
      assert.equal(persisted.body.waitingRoom.expiresAt, joined.body.waitingRoom.expiresAt);
    });
    await t.test("bounded room rejects new entries but existing customers can still poll", async () => {
      await room(0, limitShow, true); await room(1, limitShow, true);
      const keys = waitingRoomKeys(limitShow);
      const queued = Array.from({ length: 1000 }, (_unused, i) => ({ value: `synthetic-${i}-${runId}`, score: i + 1 }));
      await redis.zAdd(keys[0], queued);
      await redis.zAdd(keys[2], queued.map(({ value }) => ({ value, score: tomorrow.getTime() })));
      await redis.set(keys[3], "1000");
      const full = await room(2, limitShow, true);
      error(full, 429, "WAITING_ROOM_FULL"); assert.equal(full.retryAfter, "5");
      assert.equal((await room(0, limitShow)).body.waitingRoom.status, "admitted");
      assert.equal(await redis.zCard(keys[0]), 1000);
    });
    await t.test("successful bookings replay after expiry and Redis failure blocks only new bookings", async () => {
      await room(0, bookingShow, true);
      const requestId = randomUUID();
      const created = await book(0, bookingShow, requestId);
      assert.equal(created.status, 201);
      // Success does not free or extend the checkout window in this phase.
      assert.equal(await redis.zCard(waitingRoomKeys(bookingShow)[1]), 1);
      await redis.zAdd(waitingRoomKeys(bookingShow)[1], { score: 0, value: users[0].id });
      assert.equal((await book(0, bookingShow, requestId)).body.booking.id, created.body.booking.id);
      error(await book(0, bookingShow, randomUUID(), 0, { seatLabel: "A2" }), 403, "ADMISSION_REQUIRED");
      await new Promise<void>((resolve) => silentRedis.listen(0, "127.0.0.1", resolve));
      const address = silentRedis.address(); assert.ok(address && typeof address !== "string");
      servers.push(await startServer(`redis://127.0.0.1:${address.port}`));
      const failingServer = servers.length - 1;
      const began = Date.now();
      const unavailable = await book(0, bookingShow, randomUUID(), failingServer, { seatLabel: "A2" });
      error(unavailable, 503, "WAITING_ROOM_UNAVAILABLE");
      assert.equal(unavailable.retryAfter, "5"); assert.ok(Date.now() - began < 6000, "A silent Redis must time out.");
      const replay = await book(0, bookingShow, requestId, failingServer);
      assert.equal(replay.status, 200); assert.equal(replay.body.booking.id, created.body.booking.id);
      error(await room(1, bookingShow, true, failingServer), 503, "WAITING_ROOM_UNAVAILABLE");
      assert.equal(await prisma.booking.count({ where: { showId: bookingShow } }), 1);
    });
    await t.test("leaving is authenticated, POST-only, account-scoped, and rejoins at the tail", async () => {
      for (const customer of [0, 1, 2, 3]) await room(customer, leaveShow, true);
      const keys = waitingRoomKeys(leaveShow);
      const otherMembership = await redis.zScore(waitingRoomKeys(otherShow)[1], users[0].id);
      error(await request(0, `/waiting-room/${leaveShow}/leave`, undefined, { method: "POST" }), 401, "UNAUTHENTICATED");
      const getLeave = await fetch(`${servers[0]}/waiting-room/${leaveShow}/leave`, { headers: { Authorization: `Bearer ${users[0].token}` } });
      assert.equal(getLeave.status, 404); await getLeave.text();
      const before = await redis.zRangeWithScores(keys[1], 0, -1);
      const removed = await request(0, `/waiting-room/${leaveShow}/leave`, 2, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: users[1].id }) });
      assert.equal(removed.status, 200); assert.equal(removed.body.waitingRoom.status, "not_joined");
      assert.equal(removed.body.waitingRoom.expiresAt, null); assert.equal(removed.body.waitingRoom.position, null);
      assert.deepEqual(await redis.zRangeWithScores(keys[1], 0, -1), before);
      assert.equal(await redis.zScore(keys[0], users[2].id), null); assert.equal(await redis.zScore(keys[2], users[2].id), null);
      assert.equal((await room(3, leaveShow)).body.waitingRoom.position, 1);
      assert.equal((await room(2, leaveShow, true)).body.waitingRoom.position, 2);
      assert.equal(await redis.zScore(waitingRoomKeys(otherShow)[1], users[0].id), otherMembership);
      error(await leave(0, `missing-${runId}`), 404, "SHOW_NOT_FOUND");
    });
    await t.test("giving up a turn promotes the oldest waiter immediately and repeated leaves preserve its deadline", async () => {
      const keys = waitingRoomKeys(leaveShow);
      const result = await leave(0);
      assert.equal(result.status, 200); assert.equal(result.body.waitingRoom.status, "not_joined");
      // Read raw membership BEFORE any customer poll can perform promotion.
      assert.deepEqual((await redis.zRange(keys[1], 0, -1)).sort(), [users[1].id, users[3].id].sort());
      assert.equal(await redis.zScore(keys[2], users[3].id), null);
      const before = await redis.zRangeWithScores(keys[1], 0, -1);
      const repeated = await Promise.all(Array.from({ length: 8 }, (_, i) => leave(0, leaveShow, i % 2)));
      assert.ok(repeated.every((result) => result.status === 200 && result.body.waitingRoom.status === "not_joined"));
      assert.deepEqual(await redis.zRangeWithScores(keys[1], 0, -1), before);
      assert.equal((await room(0, leaveShow)).body.waitingRoom.status, "not_joined", "A late heartbeat cannot rejoin after leaving.");
      error(await book(0, leaveShow), 403, "ADMISSION_REQUIRED");
    });
    await t.test("concurrent leave and joins retain FIFO capacity and skip expired waiters", async () => {
      for (const customer of [0, 1, 2, 3]) await room(customer, leaveRaceShow, true);
      const keys = waitingRoomKeys(leaveRaceShow);
      const results = await Promise.all([leave(0, leaveRaceShow, 0), leave(0, leaveRaceShow, 1),
        ...Array.from({ length: 10 }, (_, i) => room(i + 10, leaveRaceShow, true))]);
      assert.ok(results.every((result) => result.status === 200));
      assert.deepEqual((await redis.zRange(keys[1], 0, -1)).sort(), [users[1].id, users[2].id].sort());
      const order = await redis.zRange(keys[0], 0, -1);
      assert.equal(order[0], users[3].id);
      await redis.zAdd(keys[2], { value: users[3].id, score: 0 });
      await leave(1, leaveRaceShow);
      assert.deepEqual((await redis.zRange(keys[1], 0, -1)).sort(), [users[2].id, order[1]].sort());
      assert.equal(await redis.zScore(keys[0], users[3].id), null);
      assert.equal(await redis.zCard(keys[1]), 2);
    });
    await t.test("leaving preserves confirmed bookings and successful retries but denies a fresh booking", async () => {
      for (const customer of [4, 5, 6]) await room(customer, leaveBookingShow, true);
      const requestId = randomUUID();
      const created = await book(4, leaveBookingShow, requestId); assert.equal(created.status, 201);
      assert.equal((await leave(4, leaveBookingShow)).body.waitingRoom.status, "not_joined");
      const replay = await book(4, leaveBookingShow, requestId, 1);
      assert.equal(replay.status, 200); assert.equal(replay.body.booking.id, created.body.booking.id);
      error(await book(4, leaveBookingShow, randomUUID(), 0, { seatLabel: "A2" }), 403, "ADMISSION_REQUIRED");
      assert.equal((await book(6, leaveBookingShow, randomUUID(), 0, { seatLabel: "A2" })).status, 201);
      assert.equal(await prisma.booking.count({ where: { showId: leaveBookingShow, userId: users[4].id } }), 1);
    });
    await t.test("closed and sold-out shows allow removal without admitting another customer", async () => {
      for (const showId of [pastShow, emptyShow]) {
        const keys = waitingRoomKeys(showId);
        const futureDeadline = Date.now() + 60000;
        await redis.zAdd(keys[1], { value: users[7].id, score: futureDeadline });
        await redis.zAdd(keys[0], { value: users[8].id, score: 1 });
        await redis.zAdd(keys[2], { value: users[8].id, score: futureDeadline });
        const result = await leave(7, showId);
        assert.equal(result.status, 200); assert.equal(result.body.waitingRoom.status, "not_joined");
        assert.equal(await redis.zCard(keys[1]), 0);
        assert.equal(await redis.zScore(keys[0], users[8].id), 1);
        assert.equal((await leave(8, showId)).status, 200);
        assert.equal(await redis.zCard(keys[0]), 0);
      }
    });
    await t.test("failed or throttled leaves do not pretend membership was removed", async () => {
      await room(25, leaveShow, true);
      const keys = waitingRoomKeys(leaveShow);
      const before = await redis.zRangeWithScores(keys[0], 0, -1);
      const budget = requestLimitKey(users[25].id, "waiting-room");
      await redis.zAdd(budget, Array.from({ length: 60 }, (_, i) => ({ value: `fixture-${i}`, score: Date.now() })));
      error(await leave(25), 429, "TOO_MANY_REQUESTS");
      assert.deepEqual(await redis.zRangeWithScores(keys[0], 0, -1), before);
      await redis.del(budget);
      error(await leave(25, leaveShow, servers.length - 1), 503, "WAITING_ROOM_UNAVAILABLE");
      assert.deepEqual(await redis.zRangeWithScores(keys[0], 0, -1), before);
      assert.equal((await leave(25)).body.waitingRoom.status, "not_joined");
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
      await (await getRedis()).del(showIds.flatMap(waitingRoomKeys));
      await (await getRedis()).del(users.flatMap(({ id }) => [requestLimitKey(id, "waiting-room"), requestLimitKey(id, "booking")]));
    } finally { await closeRedis(); await prisma.$disconnect(); }
  }
});
