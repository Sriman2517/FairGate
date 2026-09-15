# Phase 16: movie nights, group bookings, and automatic checkout

## What changed

FairGate now presents real films with poster artwork: RRR, Interstellar, and Dune: Part Two. The shows, cinema, dates, and prices are demo fixtures. The homepage has a featured film, poster cards, and a short booking explanation. Movie pages offer showtimes; the checkout and ticket pages share the same cinema styling.

A customer clicks **Book tickets** on a showtime. That POST joins the waiting room. If admitted, seat selection opens; otherwise the page explains that checkout is busy and updates their place automatically. There is no separate initial Join step. An authenticated page view or link prefetch cannot add an account to the queue.

Each checkout turn can complete one booking of **1–6 distinct seats**. All selected seats succeed together or none do. Confirmation has one reference, a total, and a per-seat breakdown. After success, the turn is released and the oldest live waiter can enter immediately. The confirmation page has no checkout timer.

During selection, a quiet notice explains the two-minute window. **Time left** is collapsed by default; a warning appears at 30 seconds. Expiry ends the checkout turn, not a confirmed booking.

## Stack

The stack stays Next.js/React/TypeScript, Express, PostgreSQL/Prisma, and Redis. No additional runtime package or queue service was added. A small PostgreSQL outbox and worker handle release retries. Next Image serves local poster assets.

## Read the changes in this order

| File | What to understand |
| --- | --- |
| `apps/api/prisma/schema.prisma` | Booking is now a group; BookingSeat owns each seat; BookingRelease is pending work. |
| `apps/api/prisma/migrations/20260915000000_multi_seat_bookings/migration.sql` | Backfill legacy seats before removing the old column. |
| `apps/api/src/bookings.ts` | Validate and sort 1–6 labels; select only public response fields. |
| `apps/api/src/routes/bookings.ts` | Replay, admission, atomic nested create, conflict handling, release. |
| `apps/api/src/waiting-room.ts` | Stable turn identity and compare-before-release in one Redis Lua script. |
| `apps/api/src/booking-release.ts` | Durable retries, bounded batches, duplicate-safe completion. |
| `apps/api/src/server.ts` | Start the worker and stop it before closing dependencies. |
| `apps/api/src/operations.ts` | Count BookingSeat rows so a group counts as multiple sold seats. |
| `apps/web/src/lib/booking-intent.ts` | Carry a Book tickets POST through sign-in using a short-lived HttpOnly cookie. |
| `apps/web/src/app/actions/auth.ts` and `actions/waiting-room.ts` | Continue the intent only after successful authentication; GET never executes it. |
| `apps/web/src/components/booking-form.tsx` and `app/actions/bookings.ts` | Selection, totals, retry identity, API errors, confirmation redirect. |
| `apps/web/src/components/waiting-room.tsx` | Polling, quiet timer, final warning, expiry and leave controls. |
| `apps/web/src/components/movie-poster.tsx`, pages, and `app/globals.css` | Reusable artwork, responsive catalogue, showtime cards, seat map, ticket. |
| `apps/api/prisma/seed-data.ts` | New films/show IDs; existing fictional films and tickets remain intact. |
| `apps/api/tests/bookings.test.ts` | Independent-process races, group atomicity, turn uniqueness, outbox recovery. |

## Walk through one request

1. On the Interstellar movie page, choose a showtime and click **Book tickets**. A Server Action calls `enterBooking` and POSTs to the waiting-room join endpoint.
2. A signed-out customer gets a ten-minute intent cookie and is sent to login. Login or registration sets the session cookie, checks that the intent matches the safe return path, consumes it, and POSTs the join. Ordinary account sign-in without that cookie does not join anything.
3. Redis admits at most two customers for this show. Admission returns an expiry plus `turnId`. Joining again during the same turn does not extend it or change its identity.
4. The show page reads status and availability. React polls status every five seconds. Native checkbox controls let the customer select up to six seats; the total is computed from the displayed unit price for preview.
5. Confirm submits `showId`, sorted `seatLabels`, `requestId`, and `turnId`. The API derives the customer from the session and the price from PostgreSQL; hidden fields are not trusted for identity or price.
6. The API checks for an existing `(userId, requestId)` first. Same show and same set of seats returns the old ticket, even if the turn expired. A different selection with the same key returns `REQUEST_ID_REUSED`.
7. For a new request, the API checks rate limits, show/seat validity, show start, and admission. A supplied stale turn ID is rejected.
8. One Prisma nested write creates Booking, its BookingSeat rows, and BookingRelease. Prisma executes these writes in a database transaction. The unique `(showId, seatLabel)` constraint resolves seat races. Unique `Booking.turnId` prevents two tabs from creating separate successful bookings in one turn.
9. The API tries to release the matching Redis turn, then redirects the customer to their confirmation. If release fails, the committed booking still succeeds and the durable job stays pending.
10. The worker retries due jobs in batches of up to 20, checking every five seconds. When release succeeds it deletes the job. The next live waiter can enter, provided seats remain and the show has not started.

## Why release needs a turn identity

Imagine a customer confirms a ticket, Redis is temporarily unavailable, and their original turn expires. Later they obtain another turn. A delayed release that only says “remove this user” would remove that new turn too.

Each admission therefore has a different identity. Completion says “remove this user only if the current identity equals the one saved with this booking.” Redis compares and removes atomically. Duplicate completions are harmless. The worker's delivery is at least once; the release effect is idempotent for that specific turn. This is not a distributed transaction between PostgreSQL and Redis.

The outbox is created in the same transaction as the seats, so a process crash after commit cannot lose the pending release. A failed attempt increments `attempts` and schedules another try. The immediate request and worker may race safely; deletion uses `deleteMany`, and the Redis comparison protects any newer turn.

## Why the retry key stays the same

A request can succeed on the server while the browser loses the response. Generating a new key on Retry would discard the API's ability to recognize that success. FairGate keeps the same key and seat set for an uncertain result, freezes selection, and offers **Retry same selection** plus My bookings. The retry remains available even if the checkout timer expires. Changing a normal selection creates a new key. A new turn does not silently retarget an old selection.

The API still accepts the earlier `seatLabel` single-seat payload for existing scripts. New pages use `seatLabels` and always send `turnId`. The legacy input must not be combined with `seatLabels`.

## Database upgrade and local commands

Stop both old development processes before upgrading: the old and new booking schema are not compatible with each other's code. From the repo root:

```sh
npm run db:start
npm run db:deploy
npm run db:generate
npm run db:seed
npm run typecheck
npm test
npm run build
```

Then use separate terminals:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

The migration and seed have already been run on this local checkout. Re-running deploy/seed is safe. Existing booking IDs, owners, request keys, prices, timestamps, and seats are retained; a single legacy seat becomes one BookingSeat row. Legacy bookings have a null turn ID and do not create artificial release jobs. No reset or volume deletion is required.

Showtimes are fixed for **10 October 2026**. After that date, seed new show IDs with future times instead of changing booked historical screenings. The homepage prioritizes featured real films; old catalogue records remain accessible by their original links and in ticket history.

## Verification and your review

Verification completed locally: type checks for both workspaces; all nine test suites (80 leaf test cases); both production builds; and HTTP checks against the compiled API and production Next server. The HTTP checks covered poster delivery, POST-only automatic entry, sign-up continuation, a waiting third customer, group confirmation, immediate promotion, stale selection rollback, old retry protection, timer markup/warning, private history, cross-origin rejection, and closed-show recovery. Temporary processes and fixtures were cleaned up. These HTTP checks manually forward the Secure cookie over loopback and do not claim an HTTPS browser deployment test.

Automated integration coverage includes overlapping groups through separate API processes, same-key concurrent retries, reordered seat lists, six-seat totals, one success per turn, rollback of an entire conflicting selection, durable release after failure, and an old release/replay leaving a newer turn intact. Existing waiting-room, authentication, rate-limit, operator, runtime, logging, and frontend-state checks remain in the test suite.

The migration was checked against fingerprints of all six pre-existing local bookings, including their original seats and immutable ticket data.

Review in the browser at desktop width and at 390px/320px:

- Browse the poster cards and movie details. Ensure images, headings, and showtime buttons are readable.
- Click Book tickets while signed out; sign in or register and verify that you continue automatically.
- Use three different accounts/browser profiles for one show. Two enter checkout; the third sees its waiting position. Two tabs sharing one account are not two customers.
- Select 2–6 seats using Tab and Space. At six, additional unselected seats are disabled; deselecting re-enables them. Scroll the seat map on a narrow screen without moving the whole page sideways.
- Open Time left with Enter or Space. Confirm that it starts collapsed, warns at 30 seconds, and stops seat selection at expiry.
- Confirm a group. Verify all seats, one total/reference, no timer, and prompt admission for the waiting account. My bookings should show the same group.
- Try conflicting groups from two accounts and two different selections from two tabs of one account. Check that no partial group or duplicate turn booking appears.
- Check visible focus, the skip link, readable errors, and the Leave control. Enable JavaScript for interactive seat selection and automatic updates.

Automated HTTP checks validate the rendered forms and server actions, not actual pointer/keyboard interaction or screenshot layout. Browser visual and interaction review remains a manual checkpoint in this environment.

## Small exercise before committing

Explain why each of these is needed: a unique seat constraint, a unique turn constraint, a request key, and a durable release row. They protect different failure cases.

Then change the last-seconds warning threshold from 30 to 20 seconds. Locate both the condition and the customer-facing message, make the change, and verify that the actual two-minute admission deadline remains unchanged. Revert the exercise change if you prefer the 30-second design.

## Boundaries

The turn is admission to checkout; it is not a temporary seat hold. This phase does not add payment, refunds, cancellations, seat adjacency guarantees, or bot-proof claims. Queue availability and database booking validation are separate operations; an already-admitted in-flight request may finish around expiry. PostgreSQL still decides seat ownership and one-booking-per-turn uniqueness. Deployment remains a separate future phase.

Stop here, read the changed files, run the demo, then stage and commit only when you can explain it. No commit was created for you.
