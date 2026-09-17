# FairGate

Movie booking with a virtual waiting room.

FairGate will admit customers to a cinema checkout at a controlled pace, while the booking service protects limited seat inventory. We are building it in small phases so that every part can be understood, explained, and modified.

## Current phase

**Phase 17: free deployment setup.**

Deployment files are ready for a Vercel Hobby website, Render Free API, Neon Free PostgreSQL, and Upstash Free Redis. The API has a Linux Docker image, an explicit migration-tools target, a free Render Blueprint, and repeatable deployment checks. Public hosting and HTTPS browser verification are pending account setup and your review/commit; FairGate is not yet claimed live.

Real films and poster cards now lead into Book tickets, automatic queue entry, and group bookings of 1–6 seats. A confirmed group has one reference, an itemized total, and immediate checkout-turn release. A durable outbox retries failed releases without removing a newer turn. Time left is collapsed by default, with a warning at 30 seconds.

The API accepts deployment HOST/PORT settings, exposes `/ready` for PostgreSQL/Redis checks, and drains active requests on shutdown. Shared Redis budgets now protect login and registration across API replicas. Production website calls require an explicit API origin. Those Phase 15 runtime features remain; deployment is a separate future phase.

The homepage explains the three booking steps. Page navigation has a loading fallback; waiting, admission, expiry, and unavailable checks have distinct messages. Seat maps keep eight columns with touch-sized controls and horizontal scrolling on narrow screens. Closed shows offer a direct link to other showtimes. See the Phase 14 guide for the browser review checklist.

API responses include a server-generated `X-Request-ID`. A matching JSON log line records the method, route template, status, duration, and completion/abort outcome. Request bodies, headers, query strings, and customer identifiers are excluded.

Run `npm run check` for type checks, all test suites, and the production build. The FairGate CI workflow runs the same command after a clean dependency install and migrations against temporary PostgreSQL/Redis services on pushes and pull requests. It becomes active when you push the workflow to GitHub.

Customers can leave the waiting room or give up their checkout turn. Redis removes their membership and admits the next live waiter atomically. Rejoining goes to the back of the line; confirmed bookings remain intact.

Run `npm run simulate:traffic` to send a bounded customer burst through two independent APIs, race two admitted customers for one seat, and verify successful retries. Each run saves measured latencies, status counts, admission checks, and cleanup status in an ignored JSON report. This is a local experiment, not a production capacity claim.

Operators can open `/operations` to inspect upcoming shows, seat inventory, live waiting customers, and active checkout turns. The API checks a database-backed operator role on every request. Snapshot reads never advance a queue, and unavailable Redis counts are shown as unknown.

Redis enforces a shared rolling limit of 60 waiting-room requests and 20 new booking attempts per account per minute. Excess requests receive a retry delay that the page respects. Completed booking retries remain recoverable even when the allowance is exhausted.

Customers join a show's waiting room and receive a timed checkout turn before choosing a seat. Redis shares FIFO order and admission across API processes; each show admits up to two customers for two minutes. Waiting pages check in every five seconds, and inactive waiting places expire after one minute. PostgreSQL prevents two bookings for the same seat even across separate API processes. Retrying the same request returns the existing booking. Customers can view only their own booking list and confirmation pages. Each demo show has 32 seats arranged in four rows of eight.

Start with the [Phase 17 free deployment guide](docs/phase-17-free-deployment.md). The [Phase 16 guide](docs/phase-16-movie-booking-experience.md) covers group bookings and [movie artwork credits](docs/movie-artwork.md). Earlier guides cover [deployment readiness](docs/phase-15-deployment-readiness.md), [frontend polish](docs/phase-14-frontend-polish.md), [request tracing](docs/phase-13-request-tracing.md), [automated checks](docs/phase-12-automated-checks.md), [leaving the waiting room](docs/phase-11-leave-waiting-room.md), [local traffic simulation](docs/phase-10-local-traffic-simulation.md), [the operator dashboard](docs/phase-09-operator-dashboard.md), [shared request limits](docs/phase-08-shared-request-limits.md), [the shared waiting room](docs/phase-07-shared-waiting-room.md), [safe seat booking](docs/phase-06-safe-seat-booking.md), [customer accounts](docs/phase-05-customer-accounts.md), the [PostgreSQL catalogue](docs/phase-04-postgresql-catalogue.md), [Next.js pages](docs/phase-03-nextjs-pages.md), the [in-memory catalogue](docs/phase-02-movie-catalogue.md), and the [API foundation](docs/phase-01-api-foundation.md). Use the current setup below when following an older guide.

Bookings confirm immediately and collect no payment. A checkout turn does not reserve a seat. Temporary holds, cancellation, bot defenses, and production load testing remain future work.

## First-time setup

Requirements: Node.js 22.12 or newer, npm, and Docker Desktop running Linux containers. From the repository root:

Argon2 is pinned to `0.44.0`, whose Windows binary was verified on Node.js 22.12.0. The newer `0.45.1` binary failed to load on this development setup.

```sh
npm install
```

Create the API environment file once, keeping an existing file if already configured:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

The example matches the local database in `compose.yaml`: database `fairgate`, user `fairgate`, password `fairgate_dev`, and host port `5433`. These are development credentials; the port is bound to this computer's loopback interface.

```sh
npm run db:start
npm run db:generate
npm run db:deploy
npm run db:seed
```

`db:deploy` applies the checked-in migrations. `db:seed` inserts missing demo movies, shows, and seats without changing existing rows or bookings. Neither resets the database. For Phase 16, stop the old API/web processes, run deploy, generate, and seed, then restart them. The booking migration backfills existing tickets before removing the old single-seat column. If you completed Phase 6, run `npm install` and `npm run db:start`, then restart both development servers. Phase 7 added the Redis client and local Redis service. Phase 9 adds the operator-role migration: run `npm run db:deploy` and `npm run db:generate` before restarting the API. Phase 10 adds local scripts only. Phase 11 adds leave controls with no dependency, migration, or seed changes; restart both development servers to use it.

## Everyday development

Start Docker Desktop and run `npm run db:start` if the database is stopped. Use two terminals in the repository root:

```sh
# Terminal 1: API at http://127.0.0.1:4000
npm run dev:api
```

```sh
# Terminal 2: website at http://127.0.0.1:3000
npm run dev:web
```

Open `http://127.0.0.1:3000`, choose a film and show, then open its seat map. Sign in or create an account when prompted; you will return to that show. Book tickets joins the waiting room automatically, including after sign-in. When your turn opens, choose up to six seats and confirm. The confirmation shows every seat, one booking reference, the showtime, and the total. Open **My bookings** to find it again. Prices are recorded at booking time; no payment is collected.

Accounts use a demo email and a unique passphrase of 15–128 characters. Email is not sent or verified. Next.js keeps the session token in an HttpOnly cookie; the API stores its digest in PostgreSQL and checks its seven-day expiry.

The API and PostgreSQL must be available for catalogue and account requests. Redis is also required for new login/registration, the waiting room, and new bookings. Existing session reads and logout remain independent of Redis. It runs at `127.0.0.1:6380`; the API uses that default or an optional `REDIS_URL` override. The website uses API address `http://127.0.0.1:4000` by default. To change it, copy `apps/web/.env.example` to `apps/web/.env.local`, edit `FAIRGATE_API_URL`, and restart Next.js.

Use the development commands for local HTTP testing. Production mode sets a `Secure` session cookie and requires HTTPS at the browser. Deployments must also protect the connection to the API. Phase 15 validates runtime configuration; HTTPS hosting and live deployment remain future work. See the Phase 15 guide before running production start commands. The website requires FAIRGATE_API_URL in production; private HTTP requires an explicit FAIRGATE_ALLOW_HTTP_API=true opt-in.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run test:deployment` | Build and test the Linux API image using uniquely named disposable Docker dependencies. |
| `npm run deploy:check -- --api https://API-HOST --web https://WEB-HOST` | Read-only checks for readiness, catalogue, website, sign-in form, and posters. |
| `npm run dev:api` / `npm run dev:web` | Run the API / website in development. |
| `npm run dev` | Shortcut for the API only. |
| `npm run check` | Run type checks, all test suites, and the production build; stop on failure. Services and migrations must be ready. |
| `npm test` | Run all nine test commands sequentially. |
| `npm run typecheck` | Generate required types and check both workspaces and all integration test files. |
| `npm run build` | Generate Prisma Client, compile the API, and build the website. |
| `npm run simulate:traffic -- --customers 100 --concurrency 20` | Run a local burst, seat race, and retry experiment; save a report. |
| `npm run test:traffic` | Test experiment bounds, metrics, concurrency, and failure draining without databases. |
| `npm run test:operations` | Test operator authorization, role changes, read-only snapshots, and degraded Redis responses. |
| `npm run operator:set -- --email "your-email@example.com" --role OPERATOR` | Grant an existing local account operator access; use `CUSTOMER` to revoke. |
| `npm run test:ui` | Test checkout display states and production API-origin configuration without databases. |
| `npm run test:runtime` | Test startup configuration, readiness, shutdown, and shared authentication limits. |
| `npm run test:tracing` | Test request IDs, safe log fields, errors, parallel calls, and disconnected responses without databases. |
| `npm run test:auth` | Run auth integration tests against local PostgreSQL. |
| `npm run test:bookings` | Test admitted booking races, retry handling, and ownership using separate API processes. |
| `npm run test:waiting-room` | Test FIFO order, shared capacity, expiry, and booking enforcement with real Redis and PostgreSQL. |
| `npm run test:request-limits` | Test rolling request limits across API processes, account isolation, cooldowns, and successful retries. |
| `npm run start:api` / `npm run start:web` | Run compiled apps in separate terminals; production browser auth requires HTTPS. |
| `npm start` | Shortcut for the compiled API only. |
| `npm run db:start` / `npm run db:stop` | Start / stop PostgreSQL and Redis while retaining data. |
| `npm run db:generate` | Generate Prisma Client from the schema. |
| `npm run db:deploy` | Apply migrations already present in Git. |
| `npm run db:migrate -- --name change_name` | Create and apply a migration after changing the schema locally. |
| `npm run db:seed` | Insert missing demo movies, shows, and seat inventory. |
| `npm run db:studio` | Inspect local database records in Prisma Studio. |

Auth tests require the local database at `127.0.0.1:5433/fairgate` with migrations applied. They start their own API on a free port, create uniquely named synthetic accounts, and remove those accounts and their sessions afterward. They do not need the development servers. Auth tests now also require local Redis and isolate their budgets with a unique AUTH_LIMIT_NAMESPACE. They check registration races, validation, login, isolation, expiration, revocation, database constraints, and throttling.

Booking, waiting-room, request-limit, and operations tests also require local Redis on port 6380, database 0, and use independent API processes on free ports. They create their own fixture movies, shows, seats, and customers, then remove only those fixtures in dependency order. The concurrent-request checks verify seat and FIFO admission correctness, not production throughput. Tests clean only their own Redis keys.

Generation and building require the API environment file but do not query a running database. Runtime requests and integration tests do. Stop an app before starting another on its port. PostgreSQL uses the `fairgate_postgres_data` Docker volume; removing that volume deletes its data and is not part of the normal workflow.

## API routes

Base URL: `http://127.0.0.1:4000`. Authentication endpoints use JSON. Send `Authorization: Bearer <token>` to identify a session; the API does not read browser cookies. Next.js handles that translation on the server.

| Method and path | Response |
| --- | --- |
| `GET /operations/shows` | Operator-only inventory and queue snapshot for the next 50 shows; `401` signed out, `403` customer. |
| `GET /health` | `200` when the API process can answer; no database query. |
| `GET /ready` | `200` only when PostgreSQL and Redis probes pass; otherwise `503`. |
| `GET /movies` | `200` with `{ "movies": [...] }`. |
| `GET /movies/:movieId` | `200` with `{ "movie": {...} }`, or `404`. |
| `GET /movies/:movieId/shows` | `200` with `{ "shows": [...] }`, or `404`. |
| `GET /shows/:showId` | `200` with `{ show, seats }`; each seat exposes availability, or `404` for an unknown show. |
| `POST /auth/register` | Body: `name`, `email`, `password`. `201` with public user and new session. |
| `POST /auth/login` | Body: `email`, `password`. `200` with public user and new session. |
| `GET /auth/me` | `200` with public user, or `401` for an invalid session. |
| `POST /auth/logout` | `204`; revokes the presented session and succeeds if already absent. |
| `GET /waiting-room/:showId` | Authenticated status and heartbeat; never auto-joins. |
| `POST /waiting-room/:showId/leave` | Remove the signed-in account and promote live waiters when the show is open with inventory. Confirmed bookings are unchanged. |
| `POST /waiting-room/:showId/join` | Explicit authenticated join; duplicate joins preserve membership. |
| `POST /bookings` | Body: `showId`, `seatLabel`, UUID `requestId`. `201 { booking }`, or `200` for a successful retry. |
| `GET /bookings` | `200 { bookings }` for the signed-in customer. |
| `GET /bookings/:bookingId` | `200 { booking }` for its owner; `404` for missing or other customers' bookings. |

A public user contains only `id`, `name`, and `email`. Registration/login return `session.token` and `session.expiresAt` to the Next.js server. Never copy these tokens into screenshots, logs, URLs, or commits. All auth responses use `Cache-Control: no-store`.

Auth errors include `400 INVALID_INPUT`, `400 INVALID_JSON`, `401 INVALID_CREDENTIALS`, `401 UNAUTHENTICATED`, `409 EMAIL_IN_USE`, `413 PAYLOAD_TOO_LARGE`, and `429 TOO_MANY_ATTEMPTS`. Unexpected failures return `500 INTERNAL_SERVER_ERROR` without database details. A healthy `/health` response does not prove PostgreSQL is reachable. `/ready` checks both storage dependencies. New sign-in/registration returns `503 AUTH_UNAVAILABLE` if shared limiting is unavailable, while auth throttling returns `429 TOO_MANY_ATTEMPTS` with Retry-After.

All booking endpoints require a valid session. New bookings also require an active checkout turn, otherwise `403 ADMISSION_REQUIRED`. Redis failure returns `503 WAITING_ROOM_UNAVAILABLE` for new bookings; successful request-key replays still work. A taken seat receives `409 SEAT_UNAVAILABLE`; reusing one request ID for a different show/seat receives `409 REQUEST_ID_REUSED`. A new booking for a show that has started receives `409 SHOW_STARTED`; successful retries still return their original booking. Nonexistent inventory receives `404 SEAT_NOT_FOUND`. The server derives the customer and amount rather than trusting request fields. Availability and booking responses use `Cache-Control: no-store`.

Queue joins, status checks, and leaves share 60 attempts per account in a rolling 60 seconds across all sessions and shows. New validly shaped booking attempts have a separate allowance of 20 per rolling minute, including attempts that later fail. Excess requests return `429 TOO_MANY_REQUESTS` with `Retry-After` in seconds. Successful request-key replays run before this limit and remain recoverable.

## Local traffic experiment

With local PostgreSQL/Redis running and migrations applied, run `npm run simulate:traffic`. It creates temporary fixtures and its own two API processes, then cleans them up. The default is 100 customers and join concurrency 20. Reports appear in `apps/api/reports/`; keep the configuration, report, and source revision together when interpreting results. The [Phase 10 guide](docs/phase-10-local-traffic-simulation.md) explains the measurements and limits.

## Operator access

Register an account first, then run `npm run operator:set -- --email "your-email@example.com" --role OPERATOR` from the repository root. Open `http://127.0.0.1:3000/operations` and sign in. This command only accepts the local FairGate database. Use the same command with `--role CUSTOMER` to revoke access. Changes affect existing sessions on their next operator request.

## API request tracing

Use `curl.exe -i http://127.0.0.1:4000/health` to see an `X-Request-ID`, then find its matching JSON entry in the API terminal. Every HTTP attempt gets a new diagnostic ID; booking idempotency keys keep their existing meaning. Next.js does not yet forward this API header into browser responses. See the [Phase 13 guide](docs/phase-13-request-tracing.md) for fields and limits.

## Scope and limits

- The operator dashboard is a manually refreshed snapshot of up to 50 upcoming shows, not historical telemetry. PostgreSQL counts use a consistent database transaction; Redis counts have their own observation time. These are not one atomic cross-store snapshot. The batched queue read uses the current standalone Redis deployment.
- Request limits count attempts per account; they do not establish a per-person purchase limit or prevent bulk-account abuse. Authentication and completed-request lookups still precede the limit.
- The website backs off on 429 responses. Cooldowns do not extend queue places or checkout turns, and multiple tabs share the same allowance.

- Queue capacity limits admitted customer accounts per show, not simultaneous HTTP requests or bookings per customer. Turns remain allocated until their fixed expiry unless explicitly given up; completing a booking does not automatically release them.
- Leaving is account/show scoped across tabs. A later explicit rejoin returns to the tail. Leaving cannot cancel a booking insert that already passed its admission check; successful booking retries still work.
- FIFO follows Redis join order for active waiters. Repeated joins preserve membership. A waiting page that misses check-ins for 60 seconds loses its place and must explicitly rejoin.
- Redis uses a persistent local volume; this phase does not guarantee queue recovery after data loss or provide high availability. It is not bot-proof or an edge traffic shield. See the Phase 7 guide for the exact limits.

- A seat map is a snapshot, so another customer can book a displayed seat before you confirm. PostgreSQL's unique constraint decides who succeeds. The page refreshes availability after a conflict.
- A booking is one database insert with a stored price. Show metadata on its confirmation is read from the current catalogue. Show start time is checked during request handling, not locked to the exact insert commit time.
- Email is an unverified identifier; email verification and password recovery are not implemented. All signups default to CUSTOMER. Only the local CLI can grant or revoke OPERATOR; no account is promoted automatically.
- Sessions have an absolute seven-day lifetime. Logging out revokes the current session; other sign-ins stay valid. Expired database rows are rejected but are not automatically cleaned up yet.
- Login allows 10 accepted attempts per normalized email per 15-minute fixed window; registration allows 5 separately. Both share a deployment-wide 120-attempt one-minute fixed window in Redis before password work. All API replicas must share Redis and AUTH_LIMIT_NAMESPACE. These demo budgets count successes and failures, ignore forwarded IP headers, and survive API restarts while Redis retains data. They are not per-person abuse protection; an attacker can still exhaust an email or shared service budget. Provider edge controls and capacity tuning belong to deployment setup.
- Incorrect passwords and unknown emails return the same login message. Registration explicitly reports an existing email; this is not an account-enumeration-proof flow.

## Repository layout

```text
.github/workflows/ci.yml          Clean install, fresh test database, and automated checks
compose.yaml                     Local PostgreSQL and Redis services and volumes
apps/api/
  prisma/schema.prisma           Catalogue, customer, session, seat, and booking models
  prisma/migrations/             Additive SQL history
  prisma/seed.ts                 Repeatable catalogue inserts
  src/config.ts                  Validated deployment ports, service URLs, and auth namespace
  src/server.ts                  Listener, HTTP timeouts, and termination signals
  src/lifecycle.ts               Bounded request draining and resource cleanup
  src/readiness.ts               Shared dependency probes with response deadlines
  src/app.ts                     Route registration, health checks, and error handling
  src/request-logging.ts         Request IDs and structured response lifecycle logs
  tests/request-logging.test.ts  HTTP tracing and sensitive-input exclusion checks
  src/auth/                      Input validation, password hashing, sessions
  src/routes/auth.ts             Customer account endpoints and attempt limits
  src/routes/movies.ts           Catalogue endpoints
  src/routes/shows.ts            Public show details and seat availability
  src/routes/bookings.ts         Booking creation, retries, and owner-only reads
  src/bookings.ts                Input validation and public booking response fields
  src/db.ts                      Prisma client and PostgreSQL adapter
  src/redis.ts                   Shared Redis connection and bounded failure handling
  src/waiting-room.ts            Atomic FIFO admission and expiry
  src/operations.ts              Consistent seat totals and read-only Redis counts
  src/routes/operations.ts       Session and operator authorization
  prisma/set-operator.ts         Local account role grant/revoke command
  scripts/local-traffic.ts       Bounded local burst, race, retries, and reports
  scripts/traffic-metrics.ts     Local guard, worker pool, percentile calculations
  tests/traffic-metrics.test.ts  Runner math, bounds, and failure-draining checks
  tests/operations.test.ts       Access, snapshot, expiry, and outage checks
  src/request-limits.ts          Shared rolling request allowances per account
  tests/request-limits.test.ts   Concurrent limit, expiry, and recovery checks
  src/routes/waiting-room.ts     Authenticated join and heartbeat endpoints
  tests/waiting-room.test.ts     Queue correctness across API processes
  tests/auth.test.ts             Integration tests using real local PostgreSQL
  tests/bookings.test.ts         Booking correctness across independent API processes
apps/web/src/
  app/                           Movie, show, booking, login, and account pages
  app/actions/auth.ts            Server actions and browser cookie changes
  app/actions/bookings.ts        Booking submission and conflict refresh
  components/auth-form.tsx       Forms and pending/error feedback
  app/loading.tsx                Shared loading feedback during page navigation
  components/waiting-room.tsx    Queue position, polling, countdown, and checkout visibility
  lib/waiting-room-view.ts       Pure display-state and countdown calculations
  components/use-retry-delay.ts  Cooldown feedback for queue and booking forms
  lib/retry-after.ts             Bounded parsing of API retry delays
  app/actions/waiting-room.ts    Authenticated queue checks through Next.js
  lib/auth.ts                    Server-only account API calls
  lib/bookings.ts                Server-only booking and availability API calls
  app/operations/page.tsx        Protected operator snapshot page
  lib/operations.ts             Server-only operator API call
  lib/api.ts                     Server-only catalogue API calls
  lib/api-request.ts             Shared server-only fetch policy
  lib/api-origin.ts              Production API-origin validation
apps/web/tests/                  Display-state boundary and recovery tests
docs/                            Learning guide for each phase
AGENTS.md                        Phase and commit agreement
```

Generated clients, compiled output, local environment files, and dependencies are ignored. The schema, migration, source, tests, package changes, lockfile, and guides belong in the phase's review.

## Learning workflow

The assistant implements and verifies one phase. You review the code and learning guide, ask questions, and stage and commit it yourself once it is clear. The next phase starts only when you say you are ready.
