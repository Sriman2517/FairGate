# Phase 7: A shared FIFO waiting room

FairGate now gives signed-in customers a place in line for a movie show. When a checkout turn becomes available, the oldest active waiter gets it. The existing booking API checks that turn before accepting a new booking.

The outcome is **shared admission control across API processes**. The page makes it visible, while Redis coordinates the queue and PostgreSQL continues to prevent duplicate seat bookings.

## What you can use

- Join a waiting room from the existing show page. If nobody is waiting and capacity is free, checkout opens immediately.
- See your position while waiting. The page checks your turn every five seconds after the previous response; you can also check manually.
- Reload or use another tab in the same account without creating another queue entry.
- Choose a seat during your checkout window and use the existing booking confirmation and history.
- Rejoin at the back after a checkout turn expires or an inactive waiting place is removed.

The public seat map remains a preview before admission. A place in line and a checkout turn do **not** reserve a seat or guarantee inventory. Another admitted customer can still book a displayed seat first.

## Apply and run

From the repository root, with Docker Desktop running Linux containers:

```powershell
npm install
npm run db:start
npm run typecheck
npm run test:waiting-room
npm run test:bookings
npm run test:auth
npm run build
```

Phase 7 adds the `redis` Node.js client and a Redis service in `compose.yaml`. `db:start` now starts both PostgreSQL and Redis; `db:stop` stops both while retaining their volumes. There is no new PostgreSQL migration or seed requirement if you completed Phase 6. A fresh clone still needs the database setup in the README.

Redis is bound to `127.0.0.1:6380`. The API defaults to `redis://127.0.0.1:6380`; `REDIS_URL` can override it. Your existing API `.env` can stay as it is for this local setup. The example file includes the URL for clarity. PostgreSQL remains on port 5433.

Restart the API and website in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open `http://127.0.0.1:3000`, choose a movie and future show, sign in, then select **Join waiting room**. Use local development mode for HTTP authentication; the existing production cookie still requires HTTPS.

## Read these files in order

| File | Question it answers |
| --- | --- |
| [compose.yaml](../compose.yaml) and [redis.ts](../apps/api/src/redis.ts) | How do the API processes share Redis, and what happens when it stops answering? |
| [waiting-room.ts](../apps/api/src/waiting-room.ts) | How are queue order, expiry, duplicate joins, and admission coordinated atomically? |
| [Waiting-room routes](../apps/api/src/routes/waiting-room.ts) | Where do identity, show validity, and available inventory come from? |
| [Booking routes](../apps/api/src/routes/bookings.ts) | Why does idempotency run before the admission check? |
| [app.ts](../apps/api/src/app.ts) | How are queue errors converted into safe API responses? |
| [Web helper](../apps/web/src/lib/waiting-room.ts) and [Server Action](../apps/web/src/app/actions/waiting-room.ts) | How does the browser ask about its turn without reading the session token? |
| [Waiting-room component](../apps/web/src/components/waiting-room.tsx) | How do polling, the timer, manual checks, and checkout visibility work? |
| [Show page](../apps/web/src/app/shows/%5BshowId%5D/page.tsx) and [booking form](../apps/web/src/components/booking-form.tsx) | How is this integrated with the existing movie flow and retry key? |
| [Waiting-room tests](../apps/api/tests/waiting-room.test.ts) | Which guarantees are exercised through separate API processes? |

## Why Redis is useful here

An array or map inside Express would give each API process its own queue and its own idea of free checkout capacity. Two processes could independently admit customers into the same supposedly limited pool.

Redis holds the shared state. Sorted sets give us ordered members and rank queries. A Lua script lets us compose several Redis operations into one operation that other callers cannot interleave. We need both: shared storage alone would not make a separate “count active customers, then add another” sequence safe.

PostgreSQL could implement admission with appropriate transactions and locking too. Redis is a deliberate choice for short-lived ordering and expiry operations; PostgreSQL remains the durable source of booking and inventory records. This phase does not replace the database's unique seat constraint with a Redis lock.

## Four keys per show

`waitingRoomKeys(showId)` hashes the show ID and returns four names under `fairgate:waiting-room:{showHash}`. The hash gives each show a stable namespace. It is not a secret or customer credential.

| Key suffix | Type and contents | Purpose |
| --- | --- | --- |
| `waiting` | Sorted set: customer ID → increasing sequence number | FIFO order and one entry per account. |
| `active` | Sorted set: customer ID → checkout expiry in milliseconds | Current checkout turns. |
| `leases` | Sorted set: waiting customer ID → inactivity deadline | Remove abandoned waiting places. |
| `sequence` | Integer counter | Give each new arrival an unambiguous order. |

The script uses `INCR` rather than a timestamp for queue scores. Two requests can share the same millisecond; equal sorted-set scores would then sort by member text instead of arrival. Here, FIFO means the order Redis processes new joins, not the time someone clicked a button on another device.

All four keys expire ten minutes after the show's start time. Individual waiting and checkout deadlines are checked on requests; those members do not each have a separate Redis key TTL. Hash tags keep the room's keys in one slot if a cluster-aware implementation is introduced later, but this phase uses one standalone Redis service.

## The rules

`waitingRoomRules` in the API defines the demo policy:

| Rule | Value |
| --- | --- |
| Active checkout turns per show | 2 |
| Checkout window | Up to 120 seconds, ending sooner if the show starts |
| Waiting inactivity timeout | 60 seconds since the last successful check-in |
| Maximum waiting entries per show | 1,000 |
| Suggested polling delay | 5 seconds after a response |

All API instances must run the same rules. These values are constants so the learning exercise has one place to find them. This phase has no live administrator settings or rolling policy-change protocol.

A duplicate join preserves order. A waiting customer renews their heartbeat without changing their sequence number. An admitted customer keeps the original deadline; polling or joining again cannot extend it.

Expired membership becomes `not_joined`. Reading status never creates a new entry. The customer explicitly rejoins at the tail. The script removes expired waiters **before** renewing the caller's heartbeat so a late poll cannot resurrect an old position.

## Follow a request through the system

1. Next.js renders the show and reads the signed-in customer's queue state. An unknown customer is not silently enrolled.
2. The customer submits **Join waiting room**. A Server Action validates the show ID, reads the existing HttpOnly session cookie through `bookingRequest`, and sends a Bearer-authenticated request to Express.
3. Express verifies the session and checks that the show exists, has not started, and has available seats. Those inventory reads are snapshots, not reservations.
4. One Lua script reads Redis time, removes expired members, adds a new join at the tail if needed, refreshes a waiting heartbeat, and fills available checkout slots from the head of the queue.
5. The response describes only this customer's status, position, expiry, server time, and polling delay. It contains no other customer's identity or raw session token.
6. Waiting pages poll. These requests also run cleanup and promotion, so a background worker is unnecessary for this phase. With no requests, nothing needs to advance; the next request handles elapsed deadlines.
7. Admission opens the existing booking form and refreshes the seat snapshot. The displayed countdown uses elapsed browser time relative to the server snapshot, reducing dependence on a customer's incorrectly set clock. The API remains authoritative.
8. When the customer submits a booking, Express first checks for a successful request-key replay. For a new booking it validates the seat/show, checks shared admission, then attempts the PostgreSQL insert.

The client hides and disables the booking form when admission is absent. The form stays mounted so an uncertain booking attempt retains its request UUID through a wait/rejoin. The API checks admission independently, so editing the page or posting directly cannot grant access.

## API contract

Both waiting-room endpoints require the same Bearer session used by bookings. The join endpoint needs no body: the show comes from the path, the customer comes from authentication, and the server determines order and deadlines.

| Request | Behavior |
| --- | --- |
| `POST /waiting-room/:showId/join` | Join if absent; return current membership if already waiting/admitted. |
| `GET /waiting-room/:showId` | Check the caller's state, renew an existing waiting heartbeat, and process expiry/promotion. Never auto-join. |
| `POST /bookings` | Existing contract plus `403 ADMISSION_REQUIRED` for a new booking without an active checkout turn. |

Successful queue responses are `200 { waitingRoom }`. Its `status` is `not_joined`, `waiting`, or `admitted`; `position` is one-based only while waiting. `expiresAt` is the inactivity deadline while waiting and the fixed checkout deadline while admitted. It is otherwise null.

Errors include `401 UNAUTHENTICATED`, `404 SHOW_NOT_FOUND`, `409 SHOW_STARTED`, `409 SHOW_SOLD_OUT`, `429 WAITING_ROOM_FULL`, and `503 WAITING_ROOM_UNAVAILABLE`. The last two include `Retry-After: 5`. Queue and booking responses use `Cache-Control: no-store`.

Although status uses GET, it performs queue maintenance and renews presence. Treat it as a private live check, not a cacheable public read. Only the API's Bearer-authenticated caller can renew that account's membership; Next.js invokes it on the server.

## Failure handling and honest limits

- Redis failure blocks new queue operations and new bookings with a sanitized `503`. There is no local queue fallback and no “allow everyone” fallback. Catalogue reads, booking history, and successful booking retries do not need Redis.
- Connection and command handling each have a 1.5-second deadline. A socket can connect but fail to answer; the whole operation is bounded and its connection is destroyed on timeout. A timeout does not prove that a Redis mutation never executed. Duplicate joins/status checks safely recover the current state.
- Redis uses a persistent Docker volume and append-only persistence with its default synchronization policy. This helps ordinary restarts; it is not zero-loss crash recovery or highly available failover. Losing queue data loses positions and permits; PostgreSQL bookings remain. Reconciliation after Redis data loss belongs to later work.
- The local service uses a memory limit and `noeviction` so it does not silently evict individual room keys. Memory pressure can reject writes. Lua prevents interleaving but does not roll back earlier writes after a runtime error; this demo does not claim recovery from partial script errors or corrupted Redis state.
- The cap is on **customers with active checkout turns per show**. It does not limit HTTP requests in flight or the number of bookings a customer can make during one turn. An admitted customer can make several single-seat bookings. A checkout turn stays allocated until expiry, even after a booking or logout.
- Keeping turns until expiry avoids coordinating a PostgreSQL booking commit with a Redis release. Adding immediate release requires handling retries and delayed completions so an old request cannot release a newer turn.
- A turn can expire after the admission check while a database insert is in flight. The check is not a distributed transaction with PostgreSQL and is not a strict limit on simultaneous database work.
- FIFO applies to active entries within one show. Unverified accounts can be created in bulk; there are no bot detection, proof-of-work, distributed request limits, or purchase limits in this phase. Do not call this bot-proof.
- Login, catalogue, seat reads, and the authentication/inventory checks on queue requests still reach Express/PostgreSQL. This is an application-level booking gate, not an edge waiting room protecting every endpoint from overload.
- Sleeping or heavily throttled tabs can miss the heartbeat and lose their place. An admitted but absent customer occupies capacity until the fixed deadline. There is no guaranteed wait-time estimate.

## Verification and what it proves

Phase 7 verification passed: type checking, the production build, all eight waiting-room subtests, nine booking subtests, and eight auth subtests. The 30-customer queue race admitted exactly two customers and left 28 waiting through two API processes.

HTTP checks also passed against the rendered Next.js forms: registration return path, explicit and duplicate joins, waiting position, promotion into checkout, booking confirmation, expiry, completed-request replay, direct new-booking rejection, cross-origin queue action rejection, and the owner's booking list. Temporary records were removed afterward. The in-app browser remained on a connection-error page and its URL policy blocked recovery, so visual layout and client-side automatic polling/countdown interaction were not verified in a browser. Use the exercise below to check those locally.

Run the commands above against the local services. The integration suites create uniquely identified synthetic accounts and shows, use independent API processes, and remove only their own PostgreSQL rows and Redis keys. They never flush Redis, reset the database, or pause a shared service.

The waiting-room suite checks duplicate joins, fixed deadlines, FIFO promotion, late heartbeats, explicit rejoining, 30 concurrent joins with only two admitted, account/show isolation, a newly started API reading existing membership, bounded queue size, direct-booking rejection, and completed-request replay during Redis failure. A private TCP listener that accepts but never answers simulates a stalled Redis connection.

The existing booking race now runs between two admitted customers. Its seat uniqueness, idempotency, price, ownership, and validation checks remain. The older Phase 6 guide records its historical 30-customer booking race before admission existed; this phase tests the queue separately from the two-customer checkout race.

These are correctness checks. They do not establish production requests per second, latency improvement, bot resistance, or recovery from losing Redis state. Only describe verified measurements on your resume.

## Exercise and learning checkpoint

Use three browser sessions signed in as three different demo customers. Open the same future show and join in order. The first two should receive checkout turns; the third should wait at position one. Repeatedly check or join from another tab in the third account: its position should not improve by duplication. After the earlier turns expire, the third customer's page should open checkout on its next check.

For a small change, increase `waitingRoomRules.capacity` from two to three, restart the API, and repeat with four accounts on a fresh show. Predict which assertions in the integration tests must change and why. Restore the value before running the checked-in two-slot tests. Do not change one running API instance while another still uses the old policy.

Before committing, explain these without reading the answer:

- Why is Redis shared state necessary when Express runs in two processes?
- Why would separate `ZCARD` and `ZADD` calls race even though each Redis command is atomic?
- Why use sequence scores instead of timestamp scores?
- What differs between a waiting heartbeat and a fixed checkout deadline?
- Why must expired waiters be removed before a heartbeat is renewed?
- Why is the booking request-key replay checked before Redis?
- Why is PostgreSQL still responsible for preventing duplicate bookings?
- What does this phase's capacity limit actually guarantee, and what does it leave unbounded?

Review the diff, make the exercise change, and commit only when you can explain it. You own staging and committing. Stop at this checkpoint before adding another phase.

## References

[Redis sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/) describes member ordering and ranks. [Redis Lua scripting](https://redis.io/docs/latest/develop/programmability/eval-intro/) explains atomic script execution and its limitations. [Node-Redis production usage](https://redis.io/docs/latest/develop/clients/nodejs/produsage/) covers connection failures and offline command queues. The Next.js changes follow the version-matched Server Actions and router documentation bundled with this repository's installed Next.js package.
