import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

// No host DATABASE_URL is read. Every dependency belongs to this unique Docker run.
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.name, "fairgate");
const docker = process.env.DOCKER_BIN || "docker";
const suffix = randomUUID();
const network = `fairgate-verify-${suffix}`;
const names = { db: `${network}-db`, redis: `${network}-redis`, api: `${network}-api` };
const owned = [];
let networkCreated = false;
const runtime = "fairgate-api:verify";
const tools = "fairgate-api-tools:verify";
// AbortSignal.timeout uses an unreferenced timer. Keep the CLI alive while an
// otherwise idle fetch is waiting for its deadline (including Docker restarts).
const lifetime = setInterval(() => {}, 1000);

function command(args, live = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(docker, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
      output = (output + chunk).slice(-12000);
      if (live) process.stdout.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Docker ${args[0]} failed: ${output}`)));
  });
}
async function eventually(operation, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { await operation(); return; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw last;
}
async function start(name, args) {
  await command(["run", "--detach", "--name", name, "--network", network, ...args]);
  owned.push(name);
}

try {
  await command(["build", "-f", "apps/api/Dockerfile", "-t", runtime, "."], true);
  await command(["build", "-f", "apps/api/Dockerfile", "--target", "tools", "-t", tools, "."], true);
  assert.equal(await command(["run", "--rm", runtime, "id", "-u"]), "1000");
  const dependencies = await command(["run", "--rm", runtime, "node", "-e",
    'const fs=require("fs"); for(const name of ["prisma","tsx","typescript"]) if(fs.existsSync("/app/node_modules/"+name)) process.exit(1);']);
  assert.equal(dependencies, "");
  await command(["network", "create", network]); networkCreated = true;
  const password = randomBytes(24).toString("hex");
  await start(names.db, ["--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=fairgate",
    "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=fairgate", "postgres:17-alpine"]);
  await start(names.redis, ["redis:7.4-alpine", "redis-server", "--maxmemory-policy", "noeviction"]);
  await eventually(() => command(["exec", names.db, "pg_isready", "-h", "127.0.0.1", "-U", "fairgate", "-d", "fairgate"]));
  await eventually(() => command(["exec", names.redis, "redis-cli", "ping"]));
  const env = ["-e", `DATABASE_URL=postgresql://fairgate:${password}@${names.db}:5432/fairgate`,
    "-e", `REDIS_URL=redis://${names.redis}:6379`, "-e", `AUTH_LIMIT_NAMESPACE=${suffix}`];
  for (const action of ["db:deploy", "db:seed", "db:deploy"]) {
    await command(["run", "--rm", "--network", network, ...env, tools, "npm", "run", action]);
  }
  // Render supplies PORT at runtime; verify that the image does not hard-code 4000.
  await start(names.api, ["-p", "127.0.0.1::8080", ...env, "-e", "PORT=8080", runtime]);
  const binding = await command(["port", names.api, "8080/tcp"]);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  let api = `http://${binding}`;
  async function request(path, token, body) {
    const response = await fetch(api + path, { method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return { status: response.status, data: await response.json() };
  }
  await eventually(async () => assert.equal((await request("/ready")).data.status, "ready"));
  const users = [];
  for (let i = 0; i < 3; i++) {
    const result = await request("/auth/register", undefined, { name: "Container test customer",
      email: `container-${i}-${suffix}@fairgate.test`, password: `Container test password ${suffix}` });
    assert.equal(result.status, 201); users.push(result.data.session.token);
  }
  // Advance ONLY this disposable database's show if the fixed seed date has passed.
  await command(["exec", names.api, "node", "--input-type=module", "-e",
    'import {prisma} from "./dist/db.js"; try { await prisma.show.update({where:{id:"rrr-evening"},data:{startsAt:new Date(Date.now()+86400000)}}); } finally {await prisma.$disconnect();}']);
  const showId = "rrr-evening";
  const turns = [];
  for (const token of users) turns.push((await request(`/waiting-room/${showId}/join`, token, {})).data.waitingRoom);
  assert.deepEqual(turns.map((turn) => turn.status), ["admitted", "admitted", "waiting"]);
  const input = { showId, seatLabels: ["A1", "A2"], requestId: randomUUID(), turnId: turns[0].turnId };
  const booked = await request("/bookings", users[0], input);
  assert.equal(booked.status, 201); assert.deepEqual(booked.data.booking.seatLabels, ["A1", "A2"]);
  assert.equal((await request(`/waiting-room/${showId}`, users[0])).data.waitingRoom.status, "not_joined");
  assert.equal((await request(`/waiting-room/${showId}`, users[2])).data.waitingRoom.status, "admitted");
  const conflict = await request("/bookings", users[1], { ...input, seatLabels: ["A2", "A3"], requestId: randomUUID(), turnId: turns[1].turnId });
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error.code, "SEAT_UNAVAILABLE");
  assert.ok((await request(`/shows/${showId}`)).data.seats.find((seat) => seat.label === "A3").available);
  // The initial seed exercised DATABASE_URL fallback. Now prove that the seed
  // prefers the migration URL and preserves an existing booking on a repeat run.
  await command(["run", "--rm", "--network", network, ...env,
    "-e", "DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused",
    "-e", `DIRECT_DATABASE_URL=postgresql://fairgate:${password}@${names.db}:5432/fairgate`,
    tools, "npm", "run", "db:seed"]);
  const reseededSeats = (await request(`/shows/${showId}`)).data.seats;
  assert.equal(reseededSeats.length, 32);
  for (const label of ["A1", "A2"]) assert.equal(reseededSeats.find((seat) => seat.label === label).available, false);
  await command(["restart", "--time", "15", names.api]);
  // Docker may assign a new ephemeral host port when a container restarts.
  const restartedBinding = await command(["port", names.api, "8080/tcp"]);
  assert.match(restartedBinding, /^127\.0\.0\.1:\d+$/);
  api = `http://${restartedBinding}`;
  await eventually(async () => assert.equal((await request("/ready")).status, 200));
  const replay = await request("/bookings", users[0], { ...input, seatLabels: ["A2", "A1"] });
  assert.equal(replay.status, 200); assert.equal(replay.data.booking.id, booked.data.booking.id);
  await command(["stop", "--time", "15", names.api]);
  assert.ok((await command(["logs", names.api])).includes('"event":"server_stopped","clean":true'));
  console.log("PASS Linux runtime, non-root user, no development tools, migrations and seed, direct-URL reseeding preserves bookings, native password hashing, runtime PORT, group atomicity, queue handoff, durable retry after restart, and SIGTERM shutdown.");
} catch (error) {
  if (owned.includes(names.api)) console.error(await command(["logs", "--tail", "20", names.api]).catch(() => "API logs unavailable."));
  throw error;
} finally {
  // Exact names owned by this invocation only; no prune, named volumes, or host DB.
  try {
    const cleanup = await Promise.allSettled(owned.reverse().map((name) => command(["rm", "--force", "--volumes", name])));
    if (networkCreated) await command(["network", "rm", network]);
    assert.ok(cleanup.every((result) => result.status === "fulfilled"), "Some test containers need cleanup.");
  } finally { clearInterval(lifetime); }
}
