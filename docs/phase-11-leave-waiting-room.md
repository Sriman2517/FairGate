# Phase 11: leave the waiting room and release a checkout turn

## Outcome

Customers who change their mind can choose **Leave waiting room** while waiting or **Give up my turn** after admission. The API removes their membership and can admit the oldest live waiter immediately. Returning later requires an explicit join at the back of the current line.

This phase teaches an atomic state transition: remove membership, expire abandoned entries, and fill available checkout capacity in one Redis script. There is no new dependency, migration, or configuration.

## Try it

Start the local services and both development servers from the repository root:

```powershell
npm run db:start
npm run dev:api
```

In another terminal:

```powershell
npm run dev:web
```

Use three separate browser profiles/accounts to join the same future show with available seats. Two receive checkout turns and one waits. Click **Give up my turn** in an admitted profile. The waiter is admitted in Redis immediately and sees the change on their next check, normally within five seconds. The leaving page hides seat selection, stops its polling after the successful response, and offers **Join waiting room** again.

The explanation beside the button makes the consequence visible: rejoining means the back of the line, and confirmed bookings remain yours. We deliberately use an explicit button rather than auto-leaving on tab close; closing a tab can be accidental, unreliable, or leave another tab still in use. Existing heartbeat/checkout expiry remains the fallback.

## Follow one leave request

1. The customer submits the existing waiting-room form with `operation=leave` and the show ID. The button is disabled while an action is pending or a request-limit cooldown is active.
2. The Next.js Server Action validates the operation. The server-only helper validates the show ID, reads the HttpOnly session cookie through the existing authenticated helper, and sends `POST /waiting-room/:showId/leave` to the API. The API does not accept a customer ID from the form/body.
3. Express validates the session, spends one attempt from the existing account-wide waiting-room limit, and loads the show and its availability. Missing shows return 404. A started or sold-out show can still accept a leave, but cannot grant another turn from that leave.
4. The Redis script removes the caller from FIFO order, heartbeat leases, and active checkout deadlines. It then removes expired members and, if the show is open and has inventory, promotes the oldest live waiters into free slots. Other requests cannot interleave with these steps.
5. The leaving caller receives `200` and the ordinary `waitingRoom` response with `status: "not_joined"`, null position, and null expiry. The original response shape is retained.
6. Only a successful `not_joined` response produces the confirmation notice in the page. Seat selection closes, automatic polling stops, and rejoining becomes an explicit choice. The booking form stays mounted so an uncertain successful booking still has its original request ID.

The operator dashboard remains read-only. It can observe the resulting membership on its next refresh; it is not responsible for promoting the next waiter.

## Contract and edge cases

| Situation | Result |
| --- | --- |
| Waiting customer leaves | Remove their FIFO member and heartbeat lease; other customers move forward. |
| Admitted customer leaves | Remove their deadline and fill free capacity from the oldest live waiters in the same script. |
| Same customer retries leave | Remain absent; do not remove or extend another customer's turn. |
| Late status poll after leave | Status checks never join an absent account, so the customer stays out. |
| Explicit rejoin | Join the tail; an immediately free slot may admit the customer after earlier waiters. |
| Expired waiter is next | Prune it and admit the next live waiter. |
| Show started or sold out | Remove the caller without granting a new turn. |
| No session / unknown show | `401 UNAUTHENTICATED` / `404 SHOW_NOT_FOUND`. |
| Rate limit / Redis outage | Existing `429 TOO_MANY_REQUESTS` / `503 WAITING_ROOM_UNAVAILABLE`; do not show a successful leave notice. |
| `GET /waiting-room/:id/leave` | Not a mutation route; returns 404. |

Leaves share the same 60-request rolling allowance as joins and status checks, across shows, sessions, and API processes. A denied request does not remove membership. If a response is lost after Redis executes the leave, the page cannot know whether it succeeded; checking status or retrying resolves that uncertainty.

Membership belongs to an account and show, not a browser tab. Leaving affects all tabs/sessions for that account and show. Their UI can be stale until the next response. Repeated leaves are safe when no new join intervenes. If another tab explicitly rejoins and a delayed leave executes afterward, that leave removes the new membership too: this is an account-level command, not a versioned per-membership token. Do not describe it as exactly-once delivery.

Leaving is **not booking cancellation**. An existing booking and its successful request-ID replay remain accessible after leaving. A fresh booking request checks admission and is denied until the account rejoins and is admitted again. A request that already passed its admission check before the leave can still finish; the Redis operation cannot revoke an in-flight PostgreSQL insert. We are not claiming a cross-database transaction or immediate cancellation of work already authorized.

Availability is a PostgreSQL snapshot read before the Redis operation. A seat can be booked in between, so a newly admitted customer still has no guaranteed seat. The unique booking constraint remains the final authority.

## Changed files, in reading order

| File | What to understand |
| --- | --- |
| `apps/api/src/waiting-room.ts` | Shared internal operation helper and Lua leave branch; removal and FIFO promotion are atomic. Existing boolean `getWaitingRoom` calls retain their behavior. |
| `apps/api/src/routes/waiting-room.ts` | Explicit POST route selection, session-derived identity, shared limit, and closed-show cleanup. |
| `apps/web/src/lib/waiting-room.ts` | Typed join/status/leave operation and HTTP method selection. |
| `apps/web/src/lib/waiting-room-types.ts` | Optional successful-action notice. |
| `apps/web/src/app/actions/waiting-room.ts` | Validate operation and confirm only a successful leave. |
| `apps/web/src/components/waiting-room.tsx` | Leave/give-up controls, consequence text, confirmation, and existing polling stop on `not_joined`. |
| `apps/api/tests/waiting-room.test.ts` | Six additional real PostgreSQL/Redis scenarios across independent APIs. |
| `README.md` and this guide | Current phase, endpoint, and learning checkpoint. |

## Verify

```powershell
npm run test:waiting-room
npm run test:bookings
npm run test:request-limits
npm run test:operations
npm run typecheck
npm run build
```

New checks cover authentication/method/identity, removal and tail rejoin, immediate FIFO promotion, duplicate leaves, concurrent joins, expired waiters, preserved bookings/retries, started/sold-out shows, and failure handling. Tests use their own fixtures and exact Redis keys; they never pause the shared Redis service or clear unrelated data.

## Learning exercise and checkpoint

With four customers, admit A and B and queue C then D. Predict Redis membership after each step: C leaves; A gives up their turn; C rejoins. Then perform the actions and compare your prediction with the customer pages or operator dashboard.

Explain why removing A with one Redis command and promoting D with another could race a newcomer. Explain why status polling must not automatically rejoin someone who left. Finally, trace why an old confirmed booking still replays while a new booking is denied after leaving.

Review the code and commit it yourself once it is clear. Stop here; Phase 12 starts only when you are ready.