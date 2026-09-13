# Phase 8: Shared request limits

Phase 7 limited the number of customers admitted to checkout. An account could still send unlimited queue checks or booking attempts through multiple API processes. Phase 8 adds a shared limit to those requests and teaches the page to wait before trying again.

The stack stays Next.js, Express, PostgreSQL, and Redis. There are no new dependencies, migrations, containers, or credentials in this phase.

## What changed

| Scope | Allowance per account | Requests sharing that allowance |
| --- | --- | --- |
| Waiting room | 60 attempts in a rolling 60 seconds | Joins and status checks across every show and session. |
| Booking | 20 attempts in a rolling 60 seconds | Validly shaped new booking attempts across every show and session. |

These are two separate budgets. Exhausting queue checks does not spend the booking budget. A customer's second login, another tab, another show, or a different IP header does not provide a fresh allowance. Other customers using the same network have independent account budgets.

An excess request gets `429 TOO_MANY_REQUESTS` and an integer `Retry-After` header. Waiting-room polling pauses for that delay; manual queue checks and booking submissions show a cooldown. A seat change does not reset that cooldown. The existing booking request ID stays available for retrying the same intention.

## Run and verify

From the repository root, with the existing local `.env` and Docker Desktop:

```powershell
npm run db:start
npm run typecheck
npm run test:request-limits
npm run test:waiting-room
npm run test:bookings
npm run test:auth
npm run build
```

If Phase 7 is already installed, no install, migration, or seed command is needed. Restart the API and website after applying this phase:

```powershell
# First terminal
npm run dev:api
```

```powershell
# Second terminal
npm run dev:web
```

The website remains at `http://127.0.0.1:3000`. One waiting page normally checks roughly twelve times a minute, plus initial rendering and any manual checks. Several tabs share the same account allowance.

## Read the code in this order

| File | What to understand |
| --- | --- |
| [request-limits.ts](../apps/api/src/request-limits.ts) | Policies, account keys, the atomic rolling window, and retry delay. |
| [Waiting-room routes](../apps/api/src/routes/waiting-room.ts) | Authentication, then the limit, then catalogue and queue work. |
| [Booking routes](../apps/api/src/routes/bookings.ts) | Authentication and input validation, replay lookup, limit, then seat/admission checks and insert. |
| [app.ts](../apps/api/src/app.ts) | Translating a rejected attempt into HTTP 429 and Retry-After. |
| [retry-after.ts](../apps/web/src/lib/retry-after.ts) | Reading the API's retry delay with a bounded fallback. |
| [Web queue helper](../apps/web/src/lib/waiting-room.ts) and [booking action](../apps/web/src/app/actions/bookings.ts) | Returning useful cooldown feedback without exposing credentials. |
| [use-retry-delay.ts](../apps/web/src/components/use-retry-delay.ts) | A shared countdown driven by elapsed browser time. |
| [Waiting-room component](../apps/web/src/components/waiting-room.tsx) and [booking form](../apps/web/src/components/booking-form.tsx) | Pausing automatic polling and disabling manual attempts during cooldown. |
| [request-limits.test.ts](../apps/api/tests/request-limits.test.ts) | Concurrent requests, account isolation, expiry, retries, and outages. |

The existing Redis connection handles shared access and deadlines. Existing booking and waiting-room tests now also remove the request-limit keys belonging to their synthetic customers.

## Why use a rolling window?

A fixed clock-minute counter can allow 60 requests just before one minute ends and another 60 immediately after the next starts. That is 120 requests in a very short interval, despite a nominal limit of 60 per minute.

This implementation stores timestamps of attempts that passed the limiter. For each request, it considers only timestamps in `(now - 60 seconds, now]`. It admits the request only if fewer than the allowed number remain.

A fresh account can still burst its entire allowance immediately. This is a request-count limit, not a mechanism that evenly spaces requests over time. A token bucket or a pacing mechanism would express a different policy.

## One Redis sorted set per account and scope

`requestLimitKey(userId, scope)` uses a digest of the authenticated account ID and a fixed scope name. Raw session tokens and email addresses are never stored in limiter keys. The digest is a namespace choice, not a new authentication credential.

Each sorted-set member is a server-generated UUID for one attempt, and its score is the Redis timestamp in milliseconds. A timestamp alone would be a poor member identifier: several concurrent requests can arrive in the same millisecond and collapse into one member. Unlike queue ordering, the relative order of equal timestamps does not matter here; each attempt just needs to remain distinct.

One Lua script performs these steps without interleaving another API process's attempt:

1. Read Redis time, so API instances do not supply their own clocks.
2. Remove entries at or before `now - windowMs`.
3. Count the remaining entries.
4. If the allowance is exhausted, compute when the oldest entry leaves the window and return the rounded-up delay in seconds.
5. Otherwise, insert this attempt and set the key's TTL to one window from now.

Checking the count in one call and adding the member in another would race: two processes could both see the final free allowance and both consume it. Atomic execution prevents that interleaving.

Denied requests neither append entries nor renew the key's TTL. Repeated denials do not keep pushing the cooldown forward. Accepted attempts can remain at most one window, and an idle key expires automatically. Each account/scope stores at most its configured allowance under normal operation; total memory still depends on the number of active accounts.

## Follow a booking request

1. Express verifies the Bearer session and validates the submitted show, seat, and request-ID fields.
2. It looks up a completed booking for that customer's request ID. An identical retry returns the original booking. Reusing the key for a different seat returns the existing conflict response.
3. A new attempt consumes the account's shared booking allowance. When exhausted, the request stops here with HTTP 429.
4. An allowed attempt proceeds to the existing seat lookup, show-start check, waiting-room admission check, and PostgreSQL insert.

The budget counts attempts that pass the limiter, including attempts that later receive `404 SEAT_NOT_FOUND`, `403 ADMISSION_REQUIRED`, or `409 SEAT_UNAVAILABLE`. It does not count malformed booking input or already completed request-key lookups. Failed intentions are not persisted as successful bookings, so retrying a previously failed intention spends another attempt.

For a queue request, authentication runs first and the limiter runs before show/inventory queries and queue maintenance. Unknown and closed show requests therefore spend allowance too. Under an exhausted allowance, the caller receives 429 before the show-specific error. During a Redis outage, these protected operations fail with the existing `503 WAITING_ROOM_UNAVAILABLE` response.

## Why completed retries bypass the limiter

A booking might commit successfully while the customer loses the response. Returning that stored result is how the customer safely finds out what happened. Exhausting a request budget or losing Redis must not prevent that recovery.

This choice preserves Phase 6's idempotency contract, but completed-retry traffic still reaches PostgreSQL. The limiter is not a universal cap on all booking-endpoint work. Authentication queries and the replay lookup occur before the limit; catalogue, account, and booking-history endpoints are outside the new scopes.

## What happens on the page

The API sends the retry delay in `Retry-After`. Next.js forwards it as a number in the form result. The browser's timer uses `performance.now()` to track elapsed time. It is feedback, not authority: a forged or skipped timer cannot bypass the API's Redis check.

Automatic waiting-room polling delays its next call according to Retry-After instead of continuing every five seconds. Manual controls are disabled during the same pause. Booking submissions retain their request key and do not automatically submit a purchase after the cooldown.

Cooldowns do not extend queue heartbeats or checkout turns. Excessive checks can cause a waiting place to expire while the page backs off. Another tab may also spend newly freed allowance before this tab retries, resulting in another legitimate 429. Keep one waiting-room tab open during the demo. Without JavaScript, wait the displayed delay and reload as directed; check My bookings before restarting an uncertain booking attempt.

## Scope and limitations

- These limits are per authenticated account, not per human. Bulk account creation can evade them. This phase does not claim bot-proofing or DDoS protection.
- The existing signup/login limits remain process-local. Changing authentication rate limits and establishing trusted proxy identities are separate work.
- Request limits, checkout capacity, and seat uniqueness solve different problems. Redis limits request attempts and checkout turns; PostgreSQL still enforces one booking per seat.
- Redis failure blocks new protected work; there is no permissive fallback. Redis data loss can erase rate history as well as waiting-room membership. This phase does not add highly available storage or recovery from data loss.
- All API instances must run the same policy constants. Changing policy while old instances are active has no live migration protocol here.
- The policy applies when the limiter runs, not when the full request completes. It does not bound simultaneous HTTP requests or guarantee any production throughput.
- Retry-After is when allowance is expected to become available, not a reservation of the next attempt. Queue position and active turns are maintained separately.

## Tests and evidence

Verification passed: type checking, the production build, and all 31 integration subtests (6 request-limit, 8 waiting-room, 9 booking, and 8 authentication). In the new 80-request race through two API processes, 60 requests passed and 20 received HTTP 429.

HTTP checks against the rendered Next.js forms passed for queue and booking cooldown messages, disabled controls, and successful retry after restoring only the test customer's allowance. The registration, waiting-room, booking-confirmation, expiry/replay, and cross-origin rejection flows also passed. All temporary records were removed. Client-side timer and automatic-backoff interaction were not verified in a browser in this phase; use the exercise below for that check.

The new suite runs against real local PostgreSQL and Redis, with separate API processes. It creates unique synthetic fixtures and removes only their rows and keys. It uses a private, nonresponding TCP listener to test Redis failure, without stopping the shared Redis service.

The tests exercise 80 concurrent queue requests sharing a 60-request allowance, identity across sessions and IP headers, allowance shared across shows and fresh API processes, independent customers, expiry of individual window entries, no TTL extension on denial, separate booking and queue budgets, failed attempts counting toward the booking budget, completed-request recovery, and Redis outage behavior. Expiry tests move timestamps only in their own fixture keys to avoid long sleeps.

These tests establish correctness of the stated cases. They are not a load-test report or a latency comparison. Describe the tested scenario instead of inventing throughput claims.

## Exercise and checkpoint

Start with `npm run test:request-limits` and read the test that sends 80 requests through two processes. Predict the result if each process used its own counter instead of Redis.

For a small edit, lower the waiting-room allowance from 60 to 6 in `requestLimits`, restart the API, and use a demo account on a future show. Repeated manual checks will reach the limit quickly. Observe the pause, and explain why the checkout or waiting deadline keeps running. Restore 60 and restart before running the checked-in tests. Use the same policy in every running API instance.

Before committing, explain:

- Why is a rolling window different from a fixed minute counter?
- Why does the limiter need an atomic script?
- Why is the account ID used instead of the session token or forwarded IP header?
- Why are UUID members required even though the score is a timestamp?
- Which failures consume allowance, and which requests bypass it?
- Why does a denied request not renew the key's TTL?
- How does Retry-After affect automatic polling and manual submission?
- Why do we still need the waiting room and the database's unique seat constraint?

Review and commit when you can explain and modify this phase. You own staging and commits. Stop here before starting the next phase.

## References

[Redis Lua scripting](https://redis.io/docs/latest/develop/programmability/eval-intro/) explains atomic execution. [ZREMRANGEBYSCORE](https://redis.io/docs/latest/commands/zremrangebyscore/) documents score-range removal. [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585#section-4) defines HTTP 429 and its optional Retry-After header. Frontend changes follow the installed Next.js Server Actions documentation.
