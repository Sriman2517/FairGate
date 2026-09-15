import "dotenv/config";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const database = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" ||
  database.port !== "5433" || database.pathname !== "/fairgate") {
  throw new Error("Booking tests require local PostgreSQL at 127.0.0.1:5433/fairgate.");
}
const { prisma } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
if (redisUrl.protocol !== "redis:" || redisUrl.hostname !== "127.0.0.1" || redisUrl.port !== "6380" ||
  !["", "/", "/0"].includes(redisUrl.pathname)) throw new Error("Booking tests require local Redis at 127.0.0.1:6380/0.");
const { getRedis, closeRedis } = await import("../src/redis.js");
const { waitingRoomKeys } = await import("../src/waiting-room.js");
const { requestLimitKey } = await import("../src/request-limits.js");

test("durable, isolated seat booking across independent API processes", async (t) => {
  const runId = randomUUID();
  const movieId = `booking-test-${runId}`;
  const showIds = ["main", "later", "past", "other", "group"].map((label) => `${label}-${runId}`);
  const [mainShow, laterShow, pastShow, otherShow, groupShow] = showIds;
  const users = Array.from({ length: 31 }, (_, index) => ({
    id: randomUUID(), email: `booking-${index}-${runId}@fairgate.test`, token: randomBytes(32).toString("base64url"),
  }));
  const children: ChildProcess[] = [];
  const servers: string[] = [];
  const replayKey = randomUUID();
  let replayId = "";

  async function startServer() {
    const child = fork(fileURLToPath(new URL("./helpers/booking-server.ts", import.meta.url)), {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    // Drain diagnostics without printing requests, credentials, or connection details.
    child.stderr?.resume();
    return new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, port?: number) => {
        clearTimeout(timer);
        child.off("error", onError); child.off("exit", onExit); child.off("message", onMessage);
        if (error) { child.kill(); reject(error); } else resolve(`http://127.0.0.1:${port}`);
      };
      const onError = (error: Error) => finish(error);
      const onExit = () => finish(new Error("A booking test API exited before listening."));
      const onMessage = (message: unknown) => {
        if (message && typeof message === "object" && "port" in message && typeof message.port === "number") finish(undefined, message.port);
      };
      const timer = setTimeout(() => finish(new Error("Timed out starting a booking test API.")), 30000);
      child.once("error", onError); child.once("exit", onExit); child.on("message", onMessage);
    });
  }
  async function stopServer(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill(), 5000);
      const deadline = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000);
      child.once("exit", () => { clearTimeout(timer); clearTimeout(deadline); resolve(); });
      try {
        if (child.connected) child.send("shutdown", (error) => { if (error) child.kill(); }); else child.kill();
      } catch { child.kill(); }
    });
  }
  async function request(server: number, path: string, token?: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${servers[server]}${path}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }
  function post(server: number, token: string | undefined, body: unknown) {
    return request(server, "/bookings", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function book(server: number, customer: number, seatLabel: string, requestId = randomUUID(), showId = mainShow, extras = {}) {
    return post(server, users[customer].token, { showId, seatLabel, requestId, ...extras });
  }
  function expectError(result: Awaited<ReturnType<typeof request>>, status: number, code: string) {
    assert.equal(result.status, status); assert.equal(result.body.error.code, code);
  }

  try {
    const passwordHash = await hashPassword("A reusable synthetic booking fixture password");
    const tomorrow = new Date(Date.now() + 86400000);
    await prisma.$transaction([
      prisma.movie.create({ data: { id: movieId, title: "Booking test film", synopsis: "Synthetic test fixture", language: "English", durationMinutes: 100 } }),
      prisma.show.createMany({ data: showIds.map((id) => ({ id, movieId, cinemaName: "Test cinema", screenName: "Test screen",
        startsAt: id === pastShow ? new Date(Date.now() - 60000) : tomorrow, priceInPaise: 35000, currency: "INR" as const })) }),
      prisma.showSeat.createMany({ data: showIds.flatMap((showId) => Array.from({ length: showId === mainShow || showId === groupShow ? 16 : 1 }, (_, index) => {
        const number = showId === mainShow || showId === groupShow ? 16 - index : 1; const row = showId === otherShow ? "B" : "A";
        return { showId, label: `${row}${number}`, row, number };
      })) }),
      prisma.user.createMany({ data: users.map(({ id, email }) => ({ id, email, name: "Booking test customer", passwordHash })) }),
      prisma.session.createMany({ data: users.map(({ id, token }) => ({ userId: id,
        tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: tomorrow })) }),
    ]);
    servers.push(...await Promise.all([startServer(), startServer()]));
    assert.notEqual(children[0].pid, children[1].pid, "Race requests must use separate API processes.");
    for (const showId of [mainShow, laterShow]) {
      for (const customer of [0, 1]) {
        const join = await request(customer, `/waiting-room/${showId}/join`, users[customer].token, { method: "POST" });
        assert.equal(join.status, 200); assert.equal(join.body.waitingRoom.status, "admitted");
      }
    }

    t.beforeEach(async () => {
      for (const customer of [0, 1]) {
        await request(0, `/waiting-room/${mainShow}/leave`, users[customer].token, { method: "POST" });
        const joined = await request(0, `/waiting-room/${mainShow}/join`, users[customer].token, { method: "POST" });
        assert.equal(joined.body.waitingRoom.status, "admitted");
      }
    });

    await t.test("public show detail returns ordered availability and rejects an unknown show", async () => {
      const result = await request(0, `/shows/${mainShow}`);
      assert.equal(result.status, 200); assert.equal(result.body.show.movieTitle, "Booking test film");
      assert.equal(result.body.show.id, mainShow); assert.equal(result.body.show.priceInPaise, 35000);
      assert.deepEqual(result.body.seats.map((seat: { label: string }) => seat.label), Array.from({ length: 16 }, (_, i) => `A${i + 1}`));
      assert.ok(result.body.seats.every((seat: { available: boolean }) => seat.available));
      expectError(await request(1, `/shows/missing-${runId}`), 404, "SHOW_NOT_FOUND");
    });
    await t.test("two admitted customers race one seat through two API processes; exactly one wins", async () => {
      const results = await Promise.all(users.slice(0, 2).map((_user, index) => book(index % 2, index, "A1")));
      assert.equal(results.filter((result) => result.status === 201).length, 1);
      for (const loser of results.filter((result) => result.status !== 201)) expectError(loser, 409, "SEAT_UNAVAILABLE");
      assert.equal(await prisma.bookingSeat.count({ where: { showId: mainShow, seatLabel: "A1" } }), 1);
      const availability = await request(1, `/shows/${mainShow}`);
      assert.equal(availability.body.seats.find((seat: { label: string }) => seat.label === "A1").available, false);
    });
    await t.test("concurrent identical retries return one booking and reject reuse for another seat", async () => {
      const results = await Promise.all([book(0, 0, "A2", replayKey), book(1, 0, "A2", replayKey)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
      assert.equal(results[0].body.booking.id, results[1].body.booking.id); replayId = results[0].body.booking.id;
      assert.equal(await prisma.booking.count({ where: { userId: users[0].id, requestId: replayKey } }), 1);
      expectError(await book(1, 0, "A3", replayKey), 409, "REQUEST_ID_REUSED");
    });
    await t.test("concurrent different payloads cannot share one customer's request ID", async () => {
      const key = randomUUID();
      const results = await Promise.all([book(0, 0, "A4", key), book(1, 0, "A5", key)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      expectError(results.find((result) => result.status === 409)!, 409, "REQUEST_ID_REUSED");
      assert.equal(await prisma.booking.count({ where: { userId: users[0].id, requestId: key } }), 1);
      assert.equal(await prisma.bookingSeat.count({ where: { showId: mainShow, seatLabel: { in: ["A4", "A5"] } } }), 1);
    });
    await t.test("request IDs belong to each customer and successful retries survive show start", async () => {
      const key = randomUUID();
      const independent = await Promise.all([book(0, 0, "A7", key), book(1, 1, "A8", key)]);
      assert.deepEqual(independent.map((result) => result.status), [201, 201]);
      const laterKey = randomUUID(); const original = await book(0, 0, "A1", laterKey, laterShow);
      assert.equal(original.status, 201);
      await prisma.show.update({ where: { id: laterShow }, data: { startsAt: new Date(Date.now() - 60000) } });
      const replay = await book(1, 0, "A1", laterKey, laterShow);
      assert.equal(replay.status, 200);
      for (const field of ["id", "seatLabel", "priceInPaise", "createdAt"]) assert.equal(replay.body.booking[field], original.body.booking[field]);
    });
    await t.test("identity and price come from the server; booking prices survive later edits", async () => {
      const result = await book(0, 0, "A3", randomUUID(), mainShow, { userId: users[1].id, priceInPaise: 1, currency: "USD" });
      assert.equal(result.status, 201); assert.equal(result.body.booking.priceInPaise, 35000); assert.equal(result.body.booking.currency, "INR");
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: result.body.booking.id } });
      assert.equal(stored.userId, users[0].id);
      await prisma.show.update({ where: { id: mainShow }, data: { priceInPaise: 42000 } });
      const detail = await request(1, `/bookings/${stored.id}`, users[0].token);
      assert.equal(detail.status, 200); assert.equal(detail.body.booking.priceInPaise, 35000);
      assert.equal((await request(0, `/shows/${mainShow}`)).body.show.priceInPaise, 42000);
      const oldPriceReplay = await book(1, 0, "A2", replayKey);
      assert.equal(oldPriceReplay.status, 200); assert.equal(oldPriceReplay.body.booking.priceInPaise, 35000);
      assert.equal("userId" in detail.body.booking, false); assert.equal("requestId" in detail.body.booking, false);
    });
    await t.test("booking list/detail are customer-scoped and durable in a newly started process", async () => {
      const list = await request(0, "/bookings", users[0].token);
      const own = await prisma.booking.findMany({ where: { userId: users[0].id }, select: { id: true } });
      assert.equal(list.status, 200); assert.deepEqual(list.body.bookings.map((b: { id: string }) => b.id).sort(), own.map((b) => b.id).sort());
      assert.deepEqual((await request(1, "/bookings", users[30].token)).body.bookings, []);
      for (const id of [replayId, randomUUID(), "not-a-uuid"]) expectError(await request(1, `/bookings/${id}`, users[30].token), 404, "BOOKING_NOT_FOUND");
      expectError(await request(0, "/bookings"), 401, "UNAUTHENTICATED");
      expectError(await request(0, `/bookings/${replayId}`), 401, "UNAUTHENTICATED");
      servers.push(await startServer());
      const durable = await request(2, `/bookings/${replayId}`, users[0].token);
      assert.equal(durable.status, 200); assert.equal(durable.body.booking.id, replayId);
    });
    await t.test("invalid, missing, and past seats fail without creating a booking", async () => {
      const valid = { showId: mainShow, seatLabel: "A10", requestId: randomUUID() };
      expectError(await post(0, undefined, valid), 401, "UNAUTHENTICATED");
      for (const body of [null, [], {}, { ...valid, requestId: "bad-uuid" }, { ...valid, showId: 42 }, { ...valid, seatLabel: null }]) {
        expectError(await post(0, users[0].token, body), 400, "INVALID_INPUT");
      }
      expectError(await request(0, "/bookings", users[0].token, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken" }), 400, "INVALID_JSON");
      expectError(await post(0, users[0].token, { ...valid, padding: "x".repeat(5000) }), 413, "PAYLOAD_TOO_LARGE");
      expectError(await book(0, 0, "Z99"), 404, "SEAT_NOT_FOUND");
      expectError(await book(0, 0, "A1", randomUUID(), `missing-${runId}`), 404, "SEAT_NOT_FOUND");
      expectError(await book(1, 0, "A1", randomUUID(), pastShow), 409, "SHOW_STARTED");
      assert.equal(await prisma.bookingSeat.count({ where: { showId: mainShow, seatLabel: "A10" } }), 0);
    });
    async function groupTurn(customer: number) {
      await request(0, `/waiting-room/${groupShow}/leave`, users[customer].token, { method: "POST" });
      const result = await request(0, `/waiting-room/${groupShow}/join`, users[customer].token, { method: "POST" });
      assert.equal(result.body.waitingRoom.status, "admitted");
      return result.body.waitingRoom.turnId as string;
    }
    function groupBook(customer: number, labels: string[], turnId: string, requestId = randomUUID(), server = customer % 2) {
      return post(server, users[customer].token, { showId: groupShow, seatLabels: labels, turnId, requestId });
    }
    await t.test("multi-seat input rejects empty, duplicate, oversized, mixed, and malformed selections", async () => {
      const valid = { showId: groupShow, requestId: randomUUID() };
      for (const seatLabels of [[], ["A1", "A1"], ["a1"], [null], Array.from({ length: 7 }, (_, i) => `A${i + 1}`)]) {
        expectError(await post(0, users[0].token, { ...valid, seatLabels }), 400, "INVALID_INPUT");
      }
      expectError(await post(0, users[0].token, { ...valid, seatLabels: ["A1"], seatLabel: "A1" }), 400, "INVALID_INPUT");
    });
    await t.test("overlapping group bookings through separate API processes reserve all seats or none and promote the next waiter", async () => {
      const first = await groupTurn(0); const second = await groupTurn(1);
      const waiting = await request(0, `/waiting-room/${groupShow}/join`, users[2].token, { method: "POST" });
      assert.equal(waiting.body.waitingRoom.status, "waiting");
      const results = await Promise.all([groupBook(0, ["A1", "A2"], first), groupBook(1, ["A2", "A3"], second)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      const winner = results.findIndex((result) => result.status === 201);
      expectError(results[1 - winner], 409, "SEAT_UNAVAILABLE");
      assert.equal(results[winner].body.booking.seats.length, 2);
      assert.equal(results[winner].body.booking.priceInPaise, 70000);
      assert.equal(await prisma.bookingSeat.count({ where: { showId: groupShow } }), 2);
      assert.equal(await prisma.bookingSeat.count({ where: { showId: groupShow, seatLabel: winner === 0 ? "A3" : "A1" } }), 0);
      assert.equal((await request(0, `/waiting-room/${groupShow}`, users[winner].token)).body.waitingRoom.status, "not_joined");
      assert.equal((await request(0, `/waiting-room/${groupShow}`, users[2].token)).body.waitingRoom.status, "admitted");
      for (const customer of [0, 1, 2]) await request(0, `/waiting-room/${groupShow}/leave`, users[customer].token, { method: "POST" });
    });
    await t.test("two tabs cannot complete two different bookings in one checkout turn", async () => {
      const turn = await groupTurn(0);
      const results = await Promise.all([groupBook(0, ["A4"], turn, randomUUID(), 0), groupBook(0, ["A5"], turn, randomUUID(), 1)]);
      assert.equal(results.filter((result) => result.status === 201).length, 1);
      const loser = results.find((result) => result.status !== 201)!;
      assert.ok(["TURN_USED", "ADMISSION_REQUIRED"].includes(loser.body.error.code));
      assert.equal(await prisma.booking.count({ where: { turnId: turn } }), 1);
      assert.equal(await prisma.bookingSeat.count({ where: { showId: groupShow, seatLabel: { in: ["A4", "A5"] } } }), 1);
    });
    await t.test("group retries accept reordered seats and an old replay cannot release a newer turn", async () => {
      const turn = await groupTurn(0); const key = randomUUID();
      const results = await Promise.all([groupBook(0, ["A6", "A7"], turn, key, 0), groupBook(0, ["A7", "A6"], turn, key, 1)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
      assert.equal(results[0].body.booking.id, results[1].body.booking.id);
      const next = await groupTurn(0); assert.notEqual(next, turn);
      const replay = await groupBook(0, ["A6", "A7"], turn, key);
      assert.equal(replay.status, 200);
      assert.equal((await request(0, `/waiting-room/${groupShow}`, users[0].token)).body.waitingRoom.turnId, next);
      expectError(await groupBook(0, ["A15"], turn), 403, "ADMISSION_REQUIRED");
      expectError(await groupBook(0, ["A6", "A15"], next), 409, "SEAT_UNAVAILABLE");
      assert.equal(await prisma.bookingSeat.count({ where: { showId: groupShow, seatLabel: "A15" } }), 0);
    });
    await t.test("six seats share one reference, itemized prices, and a server-calculated total", async () => {
      const turn = await groupTurn(0);
      const result = await groupBook(0, ["A8", "A9", "A10", "A11", "A12", "A13"], turn);
      assert.equal(result.status, 201);
      assert.equal(result.body.booking.seatLabels.length, 6);
      assert.equal(result.body.booking.priceInPaise, 210000);
      assert.ok(result.body.booking.seats.every((seat: { priceInPaise: number }) => seat.priceInPaise === 35000));
    });
    await t.test("a durable release survives failure and worker retries never remove a newer checkout turn", async () => {
      const { releaseBookingTurn, startReleaseWorker } = await import("../src/booking-release.js");
      const { finishWaitingRoomTurn } = await import("../src/waiting-room.js");
      const turn = await groupTurn(0);
      const booking = await prisma.booking.create({ data: {
        userId: users[0].id, showId: groupShow, requestId: randomUUID(), turnId: turn, priceInPaise: 35000,
        seats: { create: { seatLabel: "A14", priceInPaise: 35000 } },
        release: { create: { userId: users[0].id, showId: groupShow, turnId: turn, startsAt: new Date(Date.now() + 86400000) } },
      } });
      assert.equal(await releaseBookingTurn(booking.id, async () => { throw new Error("Simulated Redis outage"); }), false);
      assert.equal((await prisma.bookingRelease.findUniqueOrThrow({ where: { bookingId: booking.id } })).attempts, 1);
      assert.ok(await prisma.booking.findUnique({ where: { id: booking.id } }));
      const next = await groupTurn(0); assert.notEqual(next, turn);
      await prisma.bookingRelease.update({ where: { bookingId: booking.id }, data: { nextAttemptAt: new Date(0) } });
      const stop = startReleaseWorker();
      try {
        const deadline = Date.now() + 8000;
        while (await prisma.bookingRelease.count({ where: { bookingId: booking.id } })) {
          assert.ok(Date.now() < deadline, "The worker must drain the persisted release job");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } finally { await stop(); }
      assert.equal((await request(0, `/waiting-room/${groupShow}`, users[0].token)).body.waitingRoom.turnId, next);
      await Promise.all([finishWaitingRoomTurn(users[0].id, groupShow, new Date(Date.now() + 86400000), true, next), finishWaitingRoomTurn(users[0].id, groupShow, new Date(Date.now() + 86400000), true, next)]);
      assert.equal((await request(0, `/waiting-room/${groupShow}`, users[0].token)).body.waitingRoom.status, "not_joined");
    });

    await t.test("database constraints independently reject duplicate ownership and invalid relationships", async () => {
      const data = { userId: users[0].id, showId: mainShow, seats: { create: { seatLabel: "A16", priceInPaise: 35000 } }, requestId: randomUUID(), priceInPaise: 35000, currency: "INR" as const };
      await assert.rejects(prisma.booking.create({ data: { ...data, seats: { create: { seatLabel: "A2", priceInPaise: 35000 } } } }), { code: "P2002" });
      await assert.rejects(prisma.booking.create({ data: { ...data, requestId: replayKey } }), { code: "P2002" });
      await assert.rejects(prisma.booking.create({ data: { ...data, showId: otherShow, seats: { create: { seatLabel: "A1", priceInPaise: 35000 } } } }), { code: "P2003" });
      await assert.rejects(prisma.booking.create({ data: { ...data, userId: randomUUID() } }), { code: "P2003" });
      await assert.rejects(prisma.booking.create({ data: { ...data, priceInPaise: -1 } }));
      await assert.rejects(prisma.user.delete({ where: { id: users[0].id } }), { code: "P2003" });
      await assert.rejects(prisma.showSeat.create({ data: { showId: mainShow, label: "A1", row: "A", number: 1 } }), { code: "P2002" });
      await assert.rejects(prisma.showSeat.create({ data: { showId: mainShow, label: "A98", row: "A", number: 99 } }));
      assert.equal(await prisma.bookingSeat.count({ where: { showId: mainShow, seatLabel: "A16" } }), 0);
    });
  } finally {
    await Promise.allSettled(children.map(stopServer));
    try {
      // Exact fixture IDs only. Bookings must be removed before their restricted parents.
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
