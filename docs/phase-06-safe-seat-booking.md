# Phase 6: Safe seat booking

FairGate now connects a signed-in customer to one seat at one movie show. A customer opens a seat map, chooses an available seat, confirms a demo booking, and can view their own bookings. When requests compete for the same seat, the database decides which one succeeds.

This phase implements **one seat per booking with immediate confirmation**. There is no payment, temporary hold, cancellation, queue, or waiting room yet. A confirmed demo booking occupies its seat permanently in the current model. Building this booking boundary first gives a later waiting room something meaningful to protect.

## Read the code in this order

| File or area | What to understand |
| --- | --- |
| [schema.prisma](../apps/api/prisma/schema.prisma) and [migration.sql](../apps/api/prisma/migrations/20260913020000_add_seat_bookings/migration.sql) | Identify the seat inventory, booking ownership, and database constraints. |
| [seed.ts](../apps/api/prisma/seed.ts) | See how the existing demo shows receive seats without deleting earlier data. |
| [shows.ts](../apps/api/src/routes/shows.ts) | Follow the public read from a show to its seats and their availability. |
| [Booking helpers](../apps/api/src/bookings.ts) and [booking routes](../apps/api/src/routes/bookings.ts) | Follow authentication, idempotency lookup, the insert, and conflict recovery. |
| [sessions.ts](../apps/api/src/auth/sessions.ts) | See how the Bearer token supplies the customer ID used by the booking API. |
| [Web booking helper](../apps/web/src/lib/bookings.ts) and [Server Action](../apps/web/src/app/actions/bookings.ts) | Follow the server-side API request and success/error handling. |
| [booking-form.tsx](../apps/web/src/components/booking-form.tsx) and [show page](../apps/web/src/app/shows/%5BshowId%5D/page.tsx) | See how a selected seat and its request key survive a retry. |
| [return-to.ts](../apps/web/src/lib/return-to.ts), [booking list](../apps/web/src/app/bookings/page.tsx), and [confirmation](../apps/web/src/app/bookings/%5BbookingId%5D/page.tsx) | Follow the return to the selected show and ownership-protected booking views. |
| [bookings.test.ts](../apps/api/tests/bookings.test.ts) and [process helper](../apps/api/tests/helpers/booking-server.ts) | Read executable examples of races, retries, ownership, and database constraints. |

## Three records with different jobs

**`ShowSeat` is finite inventory.** Each demo show has 32 seats: four rows with eight seats per row. A seat belongs to a particular show; `A1` for one show is different inventory from `A1` for another show. The compound primary key `(showId, label)` identifies that exact seat.

**`Booking` records a successful claim.** It contains the customer, show and seat, a request UUID, the price and currency at booking time, and its creation timestamp. The composite foreign key `(showId, seatLabel)` points to a real `ShowSeat`. A caller cannot invent a seat or attach a seat to a different show.

**`User` supplies ownership.** One customer can have several bookings. The API derives `userId` from the validated session, never from a submitted owner field. Restrictive booking relationships prevent deleting referenced inventory or customers while their bookings remain.

Two database uniqueness rules carry the main guarantees:

| Constraint | Guarantee |
| --- | --- |
| Unique `(showId, seatLabel)` on `Booking` | At most one booking can occupy that show's seat. |
| Unique `(userId, requestId)` on `Booking` | One customer's request key identifies at most one booking. |

The price is copied from the show by the API. A price sent by the browser cannot override it. This snapshot keeps the recorded amount stable if the catalogue price changes later. `createdAt` records when the booking was created; it is not a payment or admission timestamp. Displayed show details still come from the current catalogue; this phase does not snapshot all movie and venue information.

## Why checking availability is insufficient

Imagine two API processes receive requests for seat A1. Both can read “available” before either inserts a booking. A `SELECT` followed by an unrestricted `INSERT` would let both customers succeed.

Here, both processes may attempt the insert, but PostgreSQL enforces the unique seat constraint. One insert succeeds; the other receives a uniqueness error. Prisma represents that error as `P2002`, and the API turns an ordinary competing seat claim into `409 SEAT_UNAVAILABLE`.

The seat map is a snapshot for choosing a seat. It is never permission to book that seat. Disabling an occupied seat in the browser improves the experience, while the database protects the rule even if someone bypasses the UI or sends simultaneous requests to different API processes.

There is no separate “mark seat occupied” update: the booking row itself is the claim. A single insert creates the complete booking, so this phase does not need an explicit transaction grouping several writes. PostgreSQL still executes the insert transactionally. If a later phase adds dependent writes, its transaction requirements must be reconsidered.

## Follow one booking request

1. The customer opens a show page. Next.js reads the public show endpoint without caching and renders the seats. Booked seats are unavailable to select.
2. A visitor who needs to sign in is sent to the login page with a validated local return path. After authentication, they return to the show instead of losing the booking context.
3. The form assigns a UUID to the booking attempt and submits `showId`, `seatLabel`, and `requestId` to a Server Action. It disables submission while the action is pending.
4. Next.js reads the `HttpOnly` session cookie on the server and calls `POST /bookings` with a Bearer token. The raw token never becomes a client prop or form-state field.
5. Express verifies the session and validates the input. It first looks for a booking belonging to this customer with the same request key.
6. If no prior booking exists, the API checks that the show and seat exist, checks the show start time, and reads the authoritative price. It attempts one booking insert.
7. Success returns the booking and leads to its confirmation page. A competing seat claim returns a conflict, and the form refreshes availability so the customer can choose again.

The show-start check happens while handling the request, in a query separate from the insert. A request can cross the start-time boundary between those operations. This phase does not claim a strict database guarantee that every commit occurs before the show starts.

## Retry keys: one intention, one booking

A UUID is an identifier for an attempted operation, not proof that a user is signed in. Its scope is the authenticated customer. Two customers can independently use the same request UUID without sharing ownership.

The API handles an existing `(userId, requestId)` in two ways:

- If its `showId` and `seatLabel` match the submission, return the original booking with `200`. No second booking is created.
- If either field differs, return `409 REQUEST_ID_REUSED`. Reusing a key must not silently return a booking for a different seat.

This lookup happens before checking current availability or rejecting a show that has started. A retry of an already successful booking must still recover that booking after the seat becomes occupied or the start time passes.

Two identical requests can both miss the initial lookup. The unique request-key constraint still allows only one insert. After `P2002`, the API checks the customer's request key again and performs the same payload comparison. That distinguishes a successful retry from a seat lost to another request.

The frontend retains the key when retrying the same selection after an uncertain response. It creates a new key when the customer changes the selected seat. Generating a new UUID inside every Server Action call would lose the connection between retries. The key is UI state, so a full reload can begin a fresh attempt; the customer's booking list provides a way to check whether an earlier attempt succeeded.

## API contract and ownership

Paths are relative to `http://127.0.0.1:4000`. Booking endpoints require a valid Bearer token. `POST /bookings` expects JSON; clients supply neither `userId` nor the authoritative price.

| Request | Purpose | Expected behavior |
| --- | --- | --- |
| `GET /shows/:showId` | Read a show and its seat availability. | `200 { show, seats }`; missing show returns `404 SHOW_NOT_FOUND`. No customer or booking-owner data is exposed. |
| `POST /bookings` | Submit `{ showId, seatLabel, requestId }`. | `201 { booking }` for a new booking; `200 { booking }` when recovering the same request. |
| `GET /bookings` | List the current customer's bookings. | `200 { bookings }`; another customer's bookings are excluded. |
| `GET /bookings/:bookingId` | Read one owned booking. | `200 { booking }` for its owner; a missing, malformed, or another customer's booking ID receives `404 BOOKING_NOT_FOUND`. |

Booking creation can return `400 INVALID_INPUT`, `401 UNAUTHENTICATED`, `404 SEAT_NOT_FOUND`, or `409` with `SEAT_UNAVAILABLE`, `REQUEST_ID_REUSED`, or `SHOW_STARTED`. The API validates UUIDs before passing them into database queries. Errors use the existing `{ error: { code, message } }` shape. Availability and booking responses use `Cache-Control: no-store`, and server-side fetches bypass caching too.

The confirmation page and booking list check the session and ownership through the API. Knowing a booking UUID is insufficient to read it. The sign-in return path is also untrusted input: `safeReturnTo` permits `/bookings` and `/shows/<letters-digits-hyphens>`, and falls back to `/account` for other values. It is checked again inside the auth action because hidden form inputs are editable. Authentication must not become an open redirect to another website.

## Apply and run locally

From the FairGate repository, with Docker Desktop running and the existing local database configuration in `apps/api/.env`:

```powershell
npm install
npm run db:start
npm run db:deploy
npm run db:generate
npm run db:seed
npm run typecheck
npm run test:bookings
npm run test:auth
npm run build
```

The migration adds inventory and booking tables without resetting the catalogue or accounts. The seed adds missing seats to each seeded demo show. Repeating it preserves earlier seats and bookings. Do not delete the PostgreSQL volume to apply this phase.

Start the API and web app in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open `http://127.0.0.1:3000`, choose a movie and a future show, and open its seat map. Use the development commands for local HTTP authentication; production session cookies still require HTTPS.

## What the tests demonstrate

Phase 6 verification passed: `typecheck`, `build`, the eight auth subtests, and all nine booking subtests. In the race test, 30 customers used two API processes to claim one seat: exactly one succeeded and 29 received conflicts. A newly started third process could retrieve an existing booking.

HTTP checks against the running Next.js app also passed for sign-in return paths, booking submission and confirmation, duplicate retries, stale-seat conflict feedback, refreshed disabled seats, the booking list, external return-path rejection, and cross-origin booking rejection. These checks submit the actual rendered forms. The in-app browser remained on a connection-error page during this phase, so a visual/browser-interaction check was not completed; use the walkthrough below to review the experience yourself.

The booking suite uses real PostgreSQL and separate API processes sharing the database. Concurrent customers target the same seat: exactly one booking should succeed, and the remaining customers should receive a conflict. This checks a correctness property across processes; it is not a throughput benchmark or a claim about a production traffic level.

The suite also checks retries, conflicting key reuse, ownership isolation, invalid inputs, the show-start rule, price snapshots, and database constraints. Tests use their own synthetic records and clean those records up. Restrictive relationships mean their bookings must be removed before their test customers and inventory.

Read the actual assertions before describing a result on your resume. A functional race test supports “prevented duplicate seat claims under concurrent requests.” It does not establish requests per second, latency improvement, bot resistance, or waiting-room fairness.

## Your exercise and checkpoint

Use two browser profiles or a normal and private window. Sign in as a different demo customer in each, open the same future show, and select the same available seat before submitting either form. Submit both: one customer should reach a confirmation, while the other should see a seat conflict and updated availability. Check both booking lists to confirm ownership.

For a small code exercise, improve the conflict message in the booking Server Action while keeping the API's error code unchanged. Predict which form-state branch will display it, make the change, and repeat the two-customer exercise. Then inspect the integration test that repeats a request key: explain why it returns the original booking instead of trying to take the seat again.

Before moving on, explain these without reading the implementation:

- Why can two availability checks both succeed while only one booking insert succeeds?
- Which database constraint prevents overselling, and why does it work across processes?
- Why does the API inspect a request key again after `P2002`?
- How does it distinguish an identical retry from the same key used for a different seat?
- Why does the browser's submitted customer ID or price have no authority?
- Why is one insert sufficient here, and what change might require a multi-write transaction?
- What changes in the seat map after a conflict, and when should its request key change?

Review the diff and commit when you can explain and modify it. You still own staging and commits; earlier phase changes do not need a separate commit before you can study this phase. Stop here before adding holds, payment simulation, cancellation, or the waiting room.

## Reference

[PostgreSQL's explanation of unique-index checks](https://www.postgresql.org/docs/17/index-unique-checks.html) explains how a competing insert waits for an uncommitted conflicting row and rejects a duplicate if the first transaction commits.
