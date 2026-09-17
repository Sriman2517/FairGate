# Phase 15: deployment readiness

> Roadmap update: Phase 16 became the movie/group-booking experience. Deployment setup now lives in [Phase 17](phase-17-free-deployment.md); references below to the originally planned Phase 16 deployment describe the old roadmap.

## Outcome

FairGate can take a hosting platform's port and bind address, distinguish process health from dependency readiness, and finish active API requests during a normal shutdown. Authentication budgets now live in Redis instead of process memory. All Next.js API calls share one server-only helper that validates the deployment origin.

This phase prepares the application. It does not provision a host, publish the website, run migrations against a remote database, or claim production capacity. Phase 16 is the deployment and HTTPS verification step.

## Runtime configuration

API variables:

| Variable | Development | Production |
| --- | --- | --- |
| `NODE_ENV` | Leave unset for development commands. | Set to `production` on the API service. |
| `HOST` | Defaults to `127.0.0.1`. | Defaults to `0.0.0.0`; explicitly override a copied local setting. |
| `PORT` | Defaults to `4000`. | Use the platform's port; must be 1–65535. |
| `DATABASE_URL` | Local PostgreSQL URL from `.env.example`. | Explicit database URL with its own credentials. The local `fairgate_dev` password is rejected. |
| `REDIS_URL` | Defaults to local Redis on port 6380. | Required explicitly; supports `redis://` and `rediss://`. |
| `AUTH_LIMIT_NAMESPACE` | Defaults to `main`. | Use the **same stable value across all replicas** of this deployment. Tests use unique namespaces to avoid changing live budgets. |

Website variables:

| Variable | Meaning |
| --- | --- |
| `FAIRGATE_API_URL` | Server-only API origin, for example `https://api.example.test`. Production has no automatic localhost fallback. Credentials, paths, queries, and fragments are rejected. |
| `FAIRGATE_ALLOW_HTTP_API` | Omit normally. Set to the exact string `true` only when the API connection is protected by the chosen private deployment network. It does not add encryption or validate that a network is private. |
| `PORT` | `next start` uses the platform's value, or 3000. The production start script binds to `0.0.0.0`; development still binds to loopback. |

Keep real credentials in the hosting platform's secret settings. Do not copy local `.env` files into a deployment. Retain provider certificate verification for PostgreSQL/Redis TLS; `rediss://` enables Redis TLS. The website needs browser-facing HTTPS for its existing Secure session cookie, independently of the API connection.

Production validation happens on API module initialization and on the website's first API call. The web build intentionally does not require live deployment credentials: `await connection()` marks the API call as request-time work before reading configuration. Incorrect web configuration shows the existing generic error page and cannot silently call localhost. It is still necessary to smoke-test the running website after setting environment variables.

## Liveness versus readiness

```powershell
curl.exe -i http://127.0.0.1:4000/health
curl.exe -i http://127.0.0.1:4000/ready
```

- `/health` returns 200 when the API process can answer, without querying storage.
- `/ready` performs `SELECT 1` and Redis `PING`. Both must succeed for 200; otherwise it returns 503. It exposes only `up`, `down`, or `unknown`, not connection details or error messages.
- A readiness response has a three-second deadline. Concurrent requests share the in-flight dependency probe. A timed-out probe remains shared until its underlying operations settle, so repeated probes cannot create unlimited pending database operations.
- PostgreSQL has a ten-connection pool per API process, a three-second connection/checkout timeout, a three-second server statement timeout, and a four-second client query timeout. Redis retains its existing 1.5-second operation deadline. These bounds serve different purposes; a readiness timeout does not cancel a database query by itself.
- During shutdown, new requests that still reach Express receive 503 `SERVER_DRAINING` with `Connection: close`. Connections may instead be refused once the listener closes. Both health routes use `Cache-Control: no-store` during ordinary operation.

Readiness is a dependency probe, not a migration check or guarantee that every business operation will succeed. Configure the platform's readiness probe at `/ready`, with a probe timeout longer than three seconds, and keep liveness separate where the platform supports it. Using readiness for a dependency outage takes the entire API out of rotation, including otherwise recoverable read/retry endpoints; this is a deliberate conservative deployment choice.

## Follow one sign-in request

1. The browser submits the existing Next.js Server Action. The web server uses `apiRequest()` to call its configured API origin with a five-second timeout and no cache. API redirects are rejected instead of being followed with credentials.
2. The API validates email/password shape before expensive password work. A normalized email is used consistently across registration, login, and the limiter. Malformed requests receive their existing 400/413 responses.
3. One Redis Lua operation checks the deployment-wide service budget and the appropriate email budget together. If either is exhausted, the request returns 429 `TOO_MANY_ATTEMPTS` with `Retry-After` and a displayed retry duration.
4. An accepted attempt spends both budgets **before** password verification/hash generation. Failed passwords and successful sign-ins both count. Rejected attempts do not spend the other budget or prolong either expiry.
5. If Redis cannot answer, new login and registration return 503 `AUTH_UNAVAILABLE`. There is no memory fallback. Existing session reads and logout still use PostgreSQL and do not need this auth limiter.
6. On success, session creation and the HttpOnly cookie flow are unchanged. Queue limits and booking idempotency retain their existing rules.

| Budget | Limit | Window |
| --- | --- | --- |
| Login for one normalized email | 10 accepted attempts | 15 minutes |
| Registration for one normalized email | 5 accepted attempts | 15 minutes |
| Login + registration across the deployment | 120 accepted attempts | 1 minute |

These are fixed windows starting with the first accepted attempt. Calls near adjacent boundaries can form a larger short burst. This is distinct from the rolling limits used by queue and booking requests. The service budget is a small demo resource budget, not measured production capacity or a per-person fairness guarantee. It also bounds creation of new email counter keys. The counters expire automatically; email keys contain a SHA-256 digest, which avoids raw email text but is not strong anonymization against guessing.

We removed the old per-process IP limit because Next.js made unrelated visitors appear to have the same backend IP. We do not trust arbitrary `X-Forwarded-For`/`X-Real-IP` headers. Deliberate abuse can still exhaust an email or shared service budget, and malformed requests still consume parsing/network resources. The chosen host's edge controls belong in deployment setup; this is not bot-proofing.

## Follow a shutdown

1. The API receives `SIGTERM` from its host or `SIGINT` from an interactive terminal.
2. `createShutdown()` marks it draining immediately and calls `server.close()` to stop accepting connections. Repeated signals share the same shutdown promise.
3. Existing responses may finish; only then are Prisma and Redis closed. Both cleanup functions are attempted even if one fails.
4. The process exits 0 after clean completion. A ten-second deadline forces remaining HTTP connections closed and exits 1; cleanup failure also exits 1. An interrupted booking can have an uncertain result, so the same idempotency key remains important when retrying.

The host must allow more than ten seconds before force-killing the process. Run the Node API process under the host's normal process supervisor and ensure it actually receives termination signals. Windows force-kill behavior is different from a Linux `SIGTERM`; tests call the same shutdown function directly with real HTTP connections, and the target host's signal delivery must be verified during Phase 16.

The production API also bounds header receipt to ten seconds, request receipt to fifteen seconds, and inactive sockets to thirty seconds. These are not a replacement for an upstream request/body limit or a deadline for every application operation.

## Build and start plan for Phase 16

Use Node.js 22.12 or newer, install from the repository root, and build both workspaces:

```powershell
npm ci
npm run build
```

With the intended deployment database explicitly configured, the release step will use `npm run db:deploy`. This applies existing migrations; it does not create a migration or seed demo data. Run it once per release before routing traffic, not independently on every replica. Database migrations require their configured connection; the API build generates Prisma Client but does not migrate storage.

The two service start commands are `npm run start:api` and `npm run start:web`, with each service's own environment and port. They are long-running processes. Choose the host and its TLS/private-network configuration in Phase 16 before running these against remote resources. The operator CLI is deliberately restricted to local setup. The seed writes to whichever database is configured; prepare a reviewed production demo-data/operator procedure when the destination is known.

## Files to read

| File | Responsibility |
| --- | --- |
| `apps/api/src/config.ts` | Parse and validate API runtime settings without echoing secrets. |
| `apps/api/src/server.ts`, `lifecycle.ts` | Bind address, HTTP timeouts, signals, draining, and bounded cleanup. |
| `apps/api/src/readiness.ts`, `app.ts` | Dependency probes and safe HTTP readiness/draining/error responses. |
| `apps/api/src/db.ts`, `redis.ts` | Connection settings and operation bounds. |
| `apps/api/src/auth/limits.ts`, `routes/auth.ts` | Atomic shared auth budgets before password work. |
| `apps/web/src/lib/api-origin.ts`, `api-request.ts` | Validate one server-only destination and enforce common fetch behavior. |
| `apps/web/src/lib/api.ts`, `auth.ts`, `bookings.ts` | Existing callers now use that common helper. |
| `apps/api/tests/runtime.test.ts`, `auth-limits.test.ts` | Runtime, shutdown, real dependency health, and multi-process auth checks. |
| Existing auth/operations tests | Isolated Redis namespaces and cleanup; auth regressions now require Redis. |
| `apps/web/tests/api-origin.test.ts` | Production-origin and private-HTTP opt-in checks. |
| Package files and `.env.example` files | Start/test commands, documented settings, and removal of the unused memory-limiter dependency. |

## Verify locally and learn

Keep PostgreSQL and Redis running. From the repository root:

```powershell
npm install
npm run test:runtime
npm run test:ui
npm run check
```

The new auth integration checks use independent API processes and a unique Redis namespace. They test concurrent attempts, restart behavior, spoofed headers, expiry, service budgets, and an intentionally silent private Redis fixture without stopping the real Redis service. Existing auth tests remove only their own users and counters. Runtime tests exercise graceful and forced shutdown with real local HTTP connections.

Phase 15 verification passed 74 individual test cases, both workspace type checks, and both production builds. A separate check ran the compiled API on a configured loopback port and production Next.js on another private local port. It verified registration, sign-in return paths, booking and duplicate recovery, conflict feedback, protected booking pages, external-return/cross-origin rejection, and closed-show recovery. The production cookie kept its `Secure` attribute. Its temporary users, shows, auth namespace, and helper processes were cleaned up.

That check explicitly allowed the private local HTTP API and manually forwarded its test cookie. It does not verify a browser's HTTPS cookie behavior, real TLS certificates, a hosting platform's health-check settings, or Linux signal delivery. Those remain Phase 16 deployment checks. The shutdown regression specifically covers an active response becoming an idle keep-alive connection during draining; cleanup reaps it after the response finishes.

Small exercise: explain why `/health` can return 200 while `/ready` returns 503. Then find the line that makes an invalid password spend the shared allowance, and explain why changing an API replica's `AUTH_LIMIT_NAMESPACE` would accidentally defeat that shared allowance.

Stop at this learning checkpoint. Review the diff, ask questions, and commit it yourself once clear. Deployment is the next phase.
