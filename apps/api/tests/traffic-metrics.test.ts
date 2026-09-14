import assert from "node:assert/strict";
import test from "node:test";
import { concurrentMap, readTrafficOptions, requireLocalServices, summarize } from "../scripts/traffic-metrics.js";

test("traffic options are bounded and reject ambiguous or unknown values", () => {
  assert.deepEqual(readTrafficOptions([]), { customers: 100, joinConcurrency: 20 });
  assert.deepEqual(readTrafficOptions(["--customers", "3", "--concurrency", "1"]), { customers: 3, joinConcurrency: 1 });
  for (const value of ["2", "201", "-1", "10.5", "3x", "Infinity", ""]) assert.throws(() => readTrafficOptions(["--customers", value]));
  for (const value of ["0", "51", "2.5"]) assert.throws(() => readTrafficOptions(["--concurrency", value]));
  assert.throws(() => readTrafficOptions(["--url", "https://example.com"]));
});

test("local service guard rejects remote databases, alternate ports, and other Redis databases", () => {
  const database = "postgresql://fairgate:fairgate_dev@127.0.0.1:5433/fairgate";
  requireLocalServices(database, undefined);
  requireLocalServices(database, "redis://127.0.0.1:6380/0");
  for (const invalid of [undefined, database.replace("127.0.0.1", "example.com"), database.replace("5433", "5432"), database.replace("5433/fairgate", "5433/other"), database + "?host=example.com"]) {
    assert.throws(() => requireLocalServices(invalid, undefined));
  }
  for (const invalid of ["redis://example.com:6380", "redis://127.0.0.1:6379", "redis://127.0.0.1:6380/1", "redis://127.0.0.1:6380?database=1"]) assert.throws(() => requireLocalServices(database, invalid));
});

test("metrics use nearest-rank percentiles and keep response statuses separate", () => {
  const report = summarize(Array.from({ length: 100 }, (_, i) => ({ phase: "join" as const, status: i === 99 ? 503 : 200, durationMs: 100 - i })), 2000);
  assert.deepEqual(report.latencyMs, { p50: 50, p95: 95, max: 100 });
  assert.equal(report.completedRequestsPerSecond, 50);
  assert.deepEqual(report.statuses, { "200": 99, "503": 1 });
  const empty = summarize([], 0);
  assert.deepEqual(empty.latencyMs, { p50: null, p95: null, max: null });
  assert.equal(empty.completedRequestsPerSecond, null);
  assert.deepEqual(summarize([{ phase: "join", status: null, durationMs: 10 }], 10).statuses, { "transport-error": 1 });
});

test("worker pool honors concurrency and returns results in customer order", async () => {
  let active = 0;
  let peak = 0;
  const results = await concurrentMap(13, 3, async (index) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, (index % 3) + 1));
    active--;
    return index * 2;
  });
  assert.equal(peak, 3); assert.equal(active, 0);
  assert.deepEqual(results, Array.from({ length: 13 }, (_, index) => index * 2));
});

test("failed work stops new scheduling and drains in-flight work before cleanup can run", async () => {
  const started: number[] = [];
  let finished = false;
  await assert.rejects(concurrentMap(20, 2, async (index) => {
    started.push(index);
    if (index === 0) throw new Error("synthetic failure");
    await new Promise((resolve) => setTimeout(resolve, 15));
    finished = true;
  }), /synthetic failure/);
  assert.deepEqual(started, [0, 1]);
  assert.equal(finished, true);
});