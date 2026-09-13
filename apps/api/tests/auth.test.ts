import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

// This integration suite writes synthetic accounts, so reject non-local databases.
const databaseUrl = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
if (
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.port !== "5433" ||
  databaseUrl.pathname !== "/fairgate"
) {
  throw new Error("Auth tests require the local PostgreSQL database at 127.0.0.1:5433/fairgate.");
}

// Import the application only after checking which database it will connect to.
const { app } = await import("../src/app.js");
const { prisma } = await import("../src/db.js");
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

test("customer authentication against local PostgreSQL", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  const runId = randomUUID();
  const emails = ["first", "second", "race", "throttle"].map(
    (label) => `${label}-${runId}@fairgate.test`,
  );
  const createdUserIds = new Set<string>();
  const password = "  a long FairGate passphrase  ";
  let firstToken = "";
  let secondToken = "";
  let loginToken = "";
  let firstUserId = "";

  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function request(path: string, options: RequestInit = {}) {
      const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
      const text = await response.text();
      const body = text ? JSON.parse(text) : undefined;
      assert.equal(response.headers.get("cache-control"), "no-store");
      return { status: response.status, body, headers: response.headers };
    }

    function post(path: string, body: unknown) {
      return request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    function authenticated(path: string, token: string, method = "GET") {
      return request(path, { method, headers: { Authorization: `Bearer ${token}` } });
    }

    async function register(email: string, name = "Test Customer") {
      const result = await post("/auth/register", { name, email, password });
      if (result.status === 201) createdUserIds.add(result.body.user.id);
      return result;
    }

    function expectError(result: Awaited<ReturnType<typeof request>>, status: number, code: string) {
      assert.equal(result.status, status);
      assert.equal(result.body.error.code, code);
      assert.equal(typeof result.body.error.message, "string");
    }

    await t.test("registration normalizes email and stores hashes instead of credentials", async () => {
      const result = await register(`  ${emails[0].toUpperCase()}  `, "  First Customer  ");
      assert.equal(result.status, 201);
      assert.deepEqual(Object.keys(result.body.user).sort(), ["email", "id", "name"]);
      assert.equal(result.body.user.email, emails[0]);
      assert.equal(result.body.user.name, "First Customer");
      firstUserId = result.body.user.id;
      firstToken = result.body.session.token;
      assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/);
      const ttl = Date.parse(result.body.session.expiresAt) - Date.now();
      assert.ok(ttl > 7 * 86400000 - 60000 && ttl <= 7 * 86400000);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: firstUserId } });
      assert.match(user.passwordHash, /^\$argon2id\$/);
      assert.notEqual(user.passwordHash, password);
      const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(firstToken) } });
      assert.equal(session.userId, firstUserId);
      assert.equal(session.expiresAt.toISOString(), result.body.session.expiresAt);
      assert.equal(JSON.stringify(session).includes(firstToken), false);
      assert.equal(JSON.stringify(result.body).includes(user.passwordHash), false);
      assert.equal(JSON.stringify(result.body).includes(password), false);
    });

    await t.test("duplicate and simultaneous registrations preserve email uniqueness", async () => {
      expectError(await register(emails[0].toUpperCase()), 409, "EMAIL_IN_USE");
      const results = await Promise.all([register(emails[2]), register(emails[2].toUpperCase())]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      expectError(results.find((result) => result.status === 409)!, 409, "EMAIL_IN_USE");
      assert.equal(await prisma.user.count({ where: { email: emails[2] } }), 1);
    });

    await t.test("invalid input and malformed or oversized JSON receive explicit errors", async () => {
      const valid = { name: "Test", email: emails[1], password };
      for (const change of [
        { name: " " }, { name: "x".repeat(81) }, { name: 42 },
        { email: "not-an-email" }, { email: null },
        { password: "x".repeat(14) }, { password: "x".repeat(129) }, { password: [] },
      ]) {
        expectError(await post("/auth/register", { ...valid, ...change }), 400, "INVALID_INPUT");
      }
      expectError(await post("/auth/register", null), 400, "INVALID_INPUT");
      expectError(await request("/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken",
      }), 400, "INVALID_JSON");
      expectError(await post("/auth/register", { ...valid, name: "x".repeat(5000) }), 413, "PAYLOAD_TOO_LARGE");
      assert.equal(await prisma.user.count({ where: { email: emails[1] } }), 0);
    });

    await t.test("login preserves password whitespace and hides which credential was incorrect", async () => {
      const login = await post("/auth/login", { email: emails[0].toUpperCase(), password });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.id, firstUserId);
      assert.deepEqual(Object.keys(login.body.user).sort(), ["email", "id", "name"]);
      loginToken = login.body.session.token;
      assert.match(loginToken, /^[A-Za-z0-9_-]{43}$/);
      assert.notEqual(loginToken, firstToken);
      const wrong = await post("/auth/login", { email: emails[0], password: password.trim() });
      const missing = await post("/auth/login", { email: emails[1], password });
      expectError(wrong, 401, "INVALID_CREDENTIALS");
      expectError(missing, 401, "INVALID_CREDENTIALS");
      assert.deepEqual(wrong.body, missing.body);
      expectError(await post("/auth/login", { email: emails[0], password: "x" }), 401, "INVALID_CREDENTIALS");
    });

    await t.test("current account is isolated between two customers", async () => {
      const second = await register(emails[1], "Second Customer");
      assert.equal(second.status, 201);
      secondToken = second.body.session.token;
      const first = await authenticated("/auth/me", firstToken);
      const other = await authenticated("/auth/me", secondToken);
      assert.equal(first.status, 200);
      assert.equal(other.status, 200);
      assert.equal(first.body.user.id, firstUserId);
      assert.equal(other.body.user.id, second.body.user.id);
      assert.notEqual(first.body.user.id, other.body.user.id);
      assert.deepEqual(Object.keys(first.body.user).sort(), ["email", "id", "name"]);
      expectError(await request("/auth/me"), 401, "UNAUTHENTICATED");
      expectError(await authenticated("/auth/me", "bad-token"), 401, "UNAUTHENTICATED");
      expectError(await authenticated("/auth/me", randomBytes(32).toString("base64url")), 401, "UNAUTHENTICATED");
    });

    await t.test("expired and revoked sessions fail, while another session still works", async () => {
      await prisma.session.update({ where: { tokenHash: digest(secondToken) }, data: { expiresAt: new Date(0) } });
      expectError(await authenticated("/auth/me", secondToken), 401, "UNAUTHENTICATED");
      assert.equal((await authenticated("/auth/logout", firstToken, "POST")).status, 204);
      assert.equal(await prisma.session.findUnique({ where: { tokenHash: digest(firstToken) } }), null);
      expectError(await authenticated("/auth/me", firstToken), 401, "UNAUTHENTICATED");
      assert.equal((await authenticated("/auth/me", loginToken)).status, 200);
      assert.equal((await authenticated("/auth/logout", firstToken, "POST")).status, 204);
      assert.equal((await request("/auth/logout", { method: "POST" })).status, 204);
    });

    await t.test("database rejects duplicate email and sessions without a customer", async () => {
      await assert.rejects(prisma.user.create({ data: {
        name: "Duplicate", email: emails[0], passwordHash: "must-never-be-inserted",
      } }), { code: "P2002" });
      await assert.rejects(prisma.session.create({ data: {
        tokenHash: digest(randomBytes(32).toString("base64url")),
        userId: randomUUID(), expiresAt: new Date(Date.now() + 60000),
      } }), { code: "P2003" });
    });

    // Keep throttling last: these counters intentionally persist for this API process.
    await t.test("login email and shared process limits reject repeated attempts", async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        expectError(await post("/auth/login", { email: emails[3], password }), 401, "INVALID_CREDENTIALS");
      }
      const limited = await post("/auth/login", { email: emails[3].toUpperCase(), password });
      expectError(limited, 429, "TOO_MANY_ATTEMPTS");
      assert.ok(Number(limited.headers.get("retry-after")) > 0);
      let sawProcessLimit = false;
      for (let attempt = 0; attempt < 65; attempt++) {
        const result = await post("/auth/register", {});
        if (result.status === 429) {
          expectError(result, 429, "TOO_MANY_ATTEMPTS");
          sawProcessLimit = true;
          break;
        }
        expectError(result, 400, "INVALID_INPUT");
      }
      assert.equal(sawProcessLimit, true);
      assert.equal((await authenticated("/auth/me", loginToken)).status, 200);
      assert.equal((await authenticated("/auth/logout", loginToken, "POST")).status, 204);
    });
  } finally {
    // Recover IDs even if a request created an account before an assertion failed.
    try {
      const ownUsers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      for (const user of ownUsers) createdUserIds.add(user.id);
      await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await prisma.$disconnect();
    }
  }
});
