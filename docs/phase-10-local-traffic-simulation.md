# Phase 10: repeatable local traffic simulation

## Outcome

Run one command to observe a burst of customers competing for checkout access through two independent FairGate API processes. Then race the two admitted customers for one seat and retry the winner's request. You get a JSON report with measured request latency, response-status counts, admission counts, correctness checks, and cleanup status.

This phase adds an experiment, not a new customer page. It uses the real API, PostgreSQL, and Redis. No runtime application behavior, schema, queue capacity, or request limit is changed.

## Run it

With Docker Desktop running, use the repository root:

```powershell
npm run db:start
npm run db:deploy
npm run simulate:traffic
```

The default is **100 synthetic customers**, **20 concurrent join requests**, and **two API processes** on automatically assigned loopback ports. The existing development API and website do not need to be running. The CLI generates Prisma Client before running; it adds no dependency.

For a smaller experiment:

```powershell
npm run simulate:traffic -- --customers 6 --concurrency 1
```

`--customers` accepts 3–200; `--concurrency` accepts 1–50 and controls only the join burst. The seat race always uses two concurrent requests. The ten retries use concurrency five. A default run is deliberately small enough for this local development database.

Reports are written to `apps/api/reports/traffic-<runId>.json`. Each run creates a new file; generated reports are ignored by Git. The terminal prints its absolute path. Keep a report when comparing experiments; record the commit and any uncommitted changes alongside it.

## Follow the experiment

1. Validate the CLI options and require PostgreSQL at `127.0.0.1:5433/fairgate` and Redis at `127.0.0.1:6380/0`. There is no arbitrary target-URL argument.
2. Create a uniquely named movie, main show, warmup show, seats, accounts, and sessions. Accounts use synthetic non-login password hashes. Session tokens stay in memory; only their hashes go into PostgreSQL. Public signup/password hashing is outside this measurement.
3. Fork two copies of the existing integration-test API helper. Each child imports the real application with its own database pool and Redis connection. Both share the local stores. No existing server is restarted.
4. Warm up each API with a join to the separate warmup show. This exercises the actual authenticated queue path without occupying the main show's slots. Fixture creation, process startup, and warmup are excluded from timing.
5. Start a bounded worker pool. Customers alternate between API processes by index. A worker sends the next customer's join when its previous request finishes. This is a closed-loop burst, not 100 simultaneous requests or 100 fully simulated browser sessions.
6. Count the response states and verify two admissions, the remaining customers waiting, unique contiguous waiting positions, and matching Redis membership. Client array order does not define fairness: FIFO follows Redis execution order. This burst does not prove long-running fairness; earlier waiting-room tests cover expiry and promotion.
7. The two admitted customers POST different request IDs for the same seat `A1`, one through each API. Expect one `201` booking and one `409 SEAT_UNAVAILABLE` conflict. The second seat remains free so the show itself need not sell out.
8. Retry the successful request ten times across both APIs. Every reply must be `200` with the same booking ID. Verify that PostgreSQL has exactly one booking for the main show.
9. Stop the child APIs before removing fixture bookings, seats, shows, movie, customers/sessions, and the exact Redis room/request-limit keys. Never flush Redis or reset the database. Write the report after cleanup, including failures.

The scenario has a 30-second deadline after warmup, shorter than a waiting lease. Individual requests time out after ten seconds. If this machine cannot finish in that window, the run fails rather than changing queue TTLs to manufacture a pass. Reduce concurrency or investigate the report. Ctrl+C/SIGTERM aborts requests and attempts cleanup; force-killing the process or losing local services can still leave fixtures.

A worker failure stops new scheduling and drains in-flight tasks. The parent then stops API children before cleanup, preventing a still-running booking request from recreating data after deletion. Cleanup failure produces a failed report and nonzero exit status. If cleanup is incomplete, retain the run ID: movie/show IDs and synthetic emails contain it. Inspect only those records and room keys after restoring services; do not delete other users' data to clear a failed experiment.

## Read the measurements correctly

| Field | Interpretation |
| --- | --- |
| `phases.join.requests` | Number of join attempts that completed or failed in the measured burst. |
| `latencyMs.p50` / `p95` / `max` | Request start through reading/parsing the JSON response, measured by a monotonic timer. Percentiles use nearest rank: sorted element `ceil(N × fraction) - 1`. |
| `completedRequestsPerSecond` | Settled attempts divided by elapsed phase time, including failed attempts. Interpret it with status counts. |
| `statuses` | Separate counts of HTTP statuses; missing HTTP responses appear as `transport-error`. |
| `admission` | Counts returned by joins and the configured checkout capacity. |
| `checks` | Named correctness checks; failures make the CLI exit nonzero. |
| `cleanup` | Whether normal fixture removal completed. A successful scenario with failed cleanup is still a failed run. |

Keep the phases separate. Two seat-race samples cannot support a meaningful p95 performance claim. A `409` in that race is the expected loser, not an application outage. Ten retries demonstrate recovery, not maximum retry throughput.

These numbers describe **a short local closed-loop experiment**. They do not establish sustained production throughput, maximum supported users, a before/after speedup, an edge traffic shield, or bot resistance. The load generator, API processes, and local stores compete for the same machine's resources. Concurrent users are not the same as concurrent HTTP requests, and checkout capacity limits admitted accounts rather than in-flight HTTP work.

Before putting a latency number on your resume, repeat the same configuration, retain reports and source revision, describe the hardware/runtime, and report variation. Do not turn one laptop result into an unsupported production claim. A defensible correctness statement after a passing default run is: “Verified shared admission of two checkout customers during a 100-account burst across two API processes, with a single winner in a competing seat-booking race.”

## Files to understand

| File | Purpose |
| --- | --- |
| `apps/api/scripts/local-traffic.ts` | Fixture lifecycle, child APIs, real requests, correctness checks, and report writing. |
| `apps/api/scripts/traffic-metrics.ts` | Validated configuration, local-service guard, bounded worker pool, and metrics. |
| `apps/api/tests/traffic-metrics.test.ts` | Verify bounds, local targets, percentile math, concurrency, and draining on failure. |
| `apps/api/tests/helpers/booking-server.ts` | Existing child API helper, reused unchanged. |
| Root/API `package.json` | `simulate:traffic` and `test:traffic` commands. |
| `apps/api/tsconfig.check.json` | Include scripts in type checks. |
| `.gitignore` | Exclude generated machine-specific reports. |
| `README.md` and this guide | Current setup and learning checkpoint. |

## Verification

```powershell
npm run test:traffic
npm run typecheck
npm run simulate:traffic
npm run simulate:traffic -- --customers 6 --concurrency 1
```

The five runner tests need no database. The real simulations exercise shared admission, a seat race, and successful retries against local PostgreSQL/Redis. Existing auth/booking/queue/limit/operations integration commands remain available for changes to application behavior.

## Learning exercise

Run the six-customer case with concurrency one, then with concurrency six. Predict which values must stay the same (two admitted, four waiting, one booking) and which may change (latency and phase duration). Explain why a higher requests-per-second value does not automatically mean better individual latency.

Trace one request from the worker pool through session authentication, the request limit, and Redis admission. Then trace the seat race through PostgreSQL's unique constraint. Explain why the worker pool must finish outstanding work before the fixture cleanup starts.

Review the code and report, then stage and commit the source yourself once it is clear. Stop here; Phase 11 starts only when you are ready.