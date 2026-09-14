import "dotenv/config";
import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { concurrentMap, readTrafficOptions, requireLocalServices, summarize, type Sample } from "./traffic-metrics.js";

class ScenarioFailure extends Error {}

async function main() {
  // Validate BEFORE importing database/Redis modules or creating fixtures.
  const config = readTrafficOptions(process.argv.slice(2));
  requireLocalServices(process.env.DATABASE_URL, process.env.REDIS_URL);
  const { prisma } = await import("../src/db.js");
  const { getRedis, closeRedis } = await import("../src/redis.js");
  const { waitingRoomKeys, waitingRoomRules } = await import("../src/waiting-room.js");
  const { requestLimitKey } = await import("../src/request-limits.js");
  const runId = randomUUID();
  const movieId = `traffic-${runId}`;
  const showId = `traffic-show-${runId}`;
  const warmupShowId = `traffic-warmup-${runId}`;
  const showIds = [showId, warmupShowId];
  const users = Array.from({ length: config.customers }, (_, i) => ({ id: randomUUID(),
    email: `traffic-${runId}-${i}@fairgate.test`, token: randomBytes(32).toString("base64url") }));
  const children: ChildProcess[] = [];
  const servers: string[] = [];
  const samples: Sample[] = [];
  const checks: { name: string; passed: boolean }[] = [];
  const phases: Record<string, ReturnType<typeof summarize>> = {};
  const interrupted = new AbortController();
  const onInterrupt = () => interrupted.abort();
  process.on("SIGINT", onInterrupt); process.on("SIGTERM", onInterrupt);
  let signal = interrupted.signal;
  let failure: string | null = null;
  let cleanup = "pending";
  let admission: { admitted: number; waiting: number; capacity: number } | null = null;
  const startedAt = new Date().toISOString();

  function check(condition: boolean, name: string) {
    checks.push({ name, passed: condition });
    if (!condition) throw new ScenarioFailure(name);
  }
  async function startServer() {
    const child = fork(fileURLToPath(new URL("../tests/helpers/booking-server.ts", import.meta.url)), {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"], env: process.env,
    });
    children.push(child); child.stderr?.resume();
    return new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, port?: number) => {
        clearTimeout(timer); child.off("error", onError); child.off("exit", onExit); child.off("message", onMessage);
        if (error) { child.kill(); reject(error); } else resolve(`http://127.0.0.1:${port}`);
      };
      const onError = () => finish(new ScenarioFailure("A simulation API could not start."));
      const onExit = () => finish(new ScenarioFailure("A simulation API exited before listening."));
      const onMessage = (message: unknown) => {
        if (message && typeof message === "object" && "port" in message && typeof message.port === "number") finish(undefined, message.port);
      };
      const timer = setTimeout(() => finish(new ScenarioFailure("Simulation API startup timed out.")), 30000);
      child.once("error", onError); child.once("exit", onExit); child.on("message", onMessage);
    });
  }
  async function stopServer(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const kill = setTimeout(() => child.kill(), 5000);
      const deadline = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Simulation API did not stop.")); }, 8000);
      child.once("exit", () => { clearTimeout(kill); clearTimeout(deadline); resolve(); });
      if (child.connected) child.send("shutdown", (error) => { if (error) child.kill(); }); else child.kill();
    });
  }
  async function request(userIndex: number, server: number, path: string, phase?: Sample["phase"], body?: object) {
    const started = performance.now();
    let status: number | null = null;
    try {
      signal.throwIfAborted();
      const response = await fetch(`${servers[server]}${path}`, {
        method: "POST", headers: { Authorization: `Bearer ${users[userIndex].token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      status = response.status;
      const data = await response.json() as { waitingRoom?: { status: string; position: number | null }; booking?: { id: string }; error?: { code: string } };
      return { status, data, userIndex };
    } finally {
      if (phase) samples.push({ phase, status, durationMs: performance.now() - started });
    }
  }
  async function measure<T>(phase: Sample["phase"], action: () => Promise<T>) {
    const started = performance.now();
    try { return await action(); }
    finally { phases[phase] = summarize(samples.filter((sample) => sample.phase === phase), performance.now() - started); }
  }
  try {
    console.log(`Local traffic simulation ${runId}: ${config.customers} customers, join concurrency ${config.joinConcurrency}, two API processes.`);
    const tomorrow = new Date(Date.now() + 86400000);
    await prisma.$transaction([
      prisma.movie.create({ data: { id: movieId, title: "Traffic simulation fixture", synopsis: "Temporary local experiment", language: "English", durationMinutes: 100 } }),
      prisma.show.createMany({ data: showIds.map((id) => ({ id, movieId, cinemaName: "Test cinema", screenName: "Test screen", startsAt: tomorrow, priceInPaise: 30000 })) }),
      prisma.showSeat.createMany({ data: showIds.flatMap((id) => [1, 2].map((number) => ({ showId: id, row: "A", number, label: `A${number}` }))) }),
      prisma.user.createMany({ data: users.map(({ id, email }) => ({ id, email, name: "Traffic fixture", passwordHash: "synthetic-no-login" })) }),
      prisma.session.createMany({ data: users.map(({ id, token }) => ({ userId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: tomorrow })) }),
    ]);
    // Sequential startup ensures a failed startup cannot race cleanup of another child.
    servers.push(await startServer()); servers.push(await startServer());
    const redis = await getRedis();
    for (const server of [0, 1]) {
      const warmup = await request(server, server, `/waiting-room/${warmupShowId}/join`);
      check(warmup.status === 200, `API ${server + 1} warmup succeeds`);
    }
    // End the experiment before leases can expire; do not alter production queue rules.
    signal = AbortSignal.any([interrupted.signal, AbortSignal.timeout(30000)]);
    console.log("Sending the bounded join burst...");
    const joins = await measure("join", () => concurrentMap(config.customers, config.joinConcurrency,
      (index) => request(index, index % 2, `/waiting-room/${showId}/join`, "join")));
    check(joins.every((result) => result.status === 200), "Every synthetic customer joins successfully");
    const admitted = joins.filter((result) => result.data.waitingRoom?.status === "admitted");
    const waiting = joins.filter((result) => result.data.waitingRoom?.status === "waiting");
    admission = { admitted: admitted.length, waiting: waiting.length, capacity: waitingRoomRules.capacity };
    check(admitted.length === waitingRoomRules.capacity && admitted.length === 2, "Exactly two customers receive checkout access");
    check(waiting.length === config.customers - admitted.length, "All remaining customers are waiting");
    const positions = waiting.map((result) => result.data.waitingRoom!.position).sort((a, b) => Number(a) - Number(b));
    check(positions.every((position, index) => position === index + 1), "Waiting positions are unique and contiguous");
    const [waitingKey, activeKey] = waitingRoomKeys(showId);
    check(await redis.zCard(activeKey) === 2 && await redis.zCard(waitingKey) === config.customers - 2, "Shared Redis membership matches HTTP admission counts");

    console.log("Racing the two admitted customers for A1, then retrying the winning request...");
    const intentions = admitted.map((customer) => ({ userIndex: customer.userIndex, requestId: randomUUID() }));
    const race = await measure("seat-race", () => concurrentMap(2, 2, (index) => request(intentions[index].userIndex, index, "/bookings", "seat-race",
      { showId, seatLabel: "A1", requestId: intentions[index].requestId })));
    check(race.filter((result) => result.status === 201).length === 1 && race.filter((result) => result.status === 409 && result.data.error?.code === "SEAT_UNAVAILABLE").length === 1,
      "The seat race returns one booking and one seat conflict");
    const winnerIndex = race.findIndex((result) => result.status === 201);
    const winner = intentions[winnerIndex];
    const replays = await measure("replay", () => concurrentMap(10, 5, (index) => request(winner.userIndex, index % 2, "/bookings", "replay",
      { showId, seatLabel: "A1", requestId: winner.requestId })));
    check(replays.every((result) => result.status === 200 && result.data.booking?.id === race[winnerIndex].data.booking?.id), "All ten retries return the original booking across both APIs");
    check(await prisma.booking.count({ where: { showId } }) === 1, "PostgreSQL contains exactly one booking for the experiment");
    signal.throwIfAborted();
  } catch (error) {
    failure = error instanceof ScenarioFailure ? error.message : "The simulation could not finish. Check local services, timeouts, and dependencies.";
  } finally {
    // Stop APIs before deleting fixtures, including after a request timeout/interruption.
    const stopped = await Promise.allSettled(children.map(stopServer));
    try {
      if (stopped.some((result) => result.status === "rejected")) throw new Error("API shutdown failed.");
      await prisma.$transaction([
        prisma.booking.deleteMany({ where: { showId: { in: showIds } } }),
        prisma.showSeat.deleteMany({ where: { showId: { in: showIds } } }),
        prisma.show.deleteMany({ where: { id: { in: showIds } } }),
        prisma.movie.deleteMany({ where: { id: movieId } }),
        prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } }),
      ]);
      await (await getRedis()).del([...showIds.flatMap(waitingRoomKeys), ...users.flatMap(({ id }) => [requestLimitKey(id, "waiting-room"), requestLimitKey(id, "booking")])]);
      cleanup = "complete";
    } catch { cleanup = "incomplete"; failure ??= "Fixture cleanup did not finish. Retain the report's run ID for inspection."; }
    finally {
      await closeRedis(); await prisma.$disconnect();
      process.off("SIGINT", onInterrupt); process.off("SIGTERM", onInterrupt);
    }
  }
  const report = { scenarioVersion: 1, runId, startedAt, finishedAt: new Date().toISOString(), passed: failure === null, failure, cleanup,
    environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    config: { ...config, apiProcesses: 2, maximumScenarioMs: 30000 }, admission, phases, checks,
    limitations: ["Local closed-loop burst; not sustained capacity or production throughput.", "Latency includes HTTP and JSON response reading; fixtures, startup and warmup are excluded.",
      "Users and sessions are pre-created; login, browser rendering and password hashing are not measured.", "The seat race has only two samples; its percentiles are not performance evidence.",
      "A 409 seat conflict is expected; status counts are not a generic error rate.", "No before/after speedup, bot resistance, or fairness under long-running traffic is claimed."] };
  const directory = new URL("../reports/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const reportFile = new URL(`traffic-${runId}.json`, directory);
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.table(Object.entries(phases).map(([phase, value]) => ({ phase, requests: value.requests,
    p50Ms: value.latencyMs.p50?.toFixed(2), p95Ms: value.latencyMs.p95?.toFixed(2),
    completedRps: value.completedRequestsPerSecond?.toFixed(2), statuses: JSON.stringify(value.statuses) })));
  console.log(`${report.passed ? "PASS" : "FAIL"}: ${checks.filter((check) => check.passed).length}/${checks.length} checks. Cleanup: ${cleanup}.`);
  console.log(`Report: ${fileURLToPath(reportFile)}`);
  if (failure) { console.error(failure); process.exitCode = 1; }
}

main().catch(() => {
  console.error("Could not run the local simulation. Use --customers 3..200 and --concurrency 1..50, check local service URLs, and ensure reports are writable.");
  process.exitCode = 1;
});