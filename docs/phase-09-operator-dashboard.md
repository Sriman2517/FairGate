# Phase 9: operator dashboard

## Outcome

An operator can open `/operations` and inspect the next 50 upcoming shows: available, booked, and total seats; customers waiting with a live heartbeat; and active checkout turns against capacity. The page is a manually refreshed snapshot. It contains no customer identities, role editor, invented bot metrics, or booking management actions.

The backend lesson is **authorization plus observation without side effects**. A monitoring page must not change the system it measures.

## Run it

From the repository root, with Docker Desktop running:

```powershell
npm run db:start
npm run db:deploy
npm run db:generate
```

Run the API and website in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Register the account you want to use at `http://127.0.0.1:3000/register`. Substitute its email in this local command:

```powershell
npm run operator:set -- --email "your-email@example.com" --role OPERATOR
```

Open `http://127.0.0.1:3000/operations` and sign in. The login form returns you to the dashboard. Role changes apply to existing sessions on their next operator API request; signing in again is unnecessary. Revoke access with:

```powershell
npm run operator:set -- --email "your-email@example.com" --role CUSTOMER
```

No account is promoted automatically. Existing accounts and public signups default to `CUSTOMER`. The command normalizes the email, requires an existing account, and only accepts the local PostgreSQL database at `127.0.0.1:5433/fairgate`. Anyone with database access already has administrative power; this command is a local bootstrap tool, not a production administration service. Emails remain unverified, so we do not grant roles based on a matching email submitted during signup.

## Follow one request

1. The browser requests `/operations`. The Next.js Server Component calls the server-only `getOperations` helper.
2. The existing authenticated request helper reads the HttpOnly session cookie and forwards only its bearer token to `GET /operations/shows`. Requests are uncached. A missing/expired session redirects to login; an ordinary customer sees an operator-access message.
3. Express validates the session and looks up the account's current role in PostgreSQL. It rejects non-operators with `403 OPERATOR_REQUIRED` before querying show counts or Redis. Client headers, query parameters, and signup fields cannot assign a role.
4. A short PostgreSQL `RepeatableRead` transaction fetches up to 51 upcoming shows ordered by start time and ID. It displays the first 50; the extra row tells us whether later shows were omitted. A matching `(startsAt, id)` index supports this ordered lookup.
5. The same transaction groups bookings by those show IDs and counts seat inventory. `availableSeats = totalSeats - bookedSeats`. Repeatable Read keeps both queries on the same database snapshot if a booking commits between them. Database uniqueness already guarantees at most one booking per seat.
6. After the transaction finishes, one Redis `EVAL_RO` script gets Redis's time and counts live waiting leases and checkout deadlines for the displayed shows. A score strictly greater than now is live. The queue's existing atomic writer keeps waiting members paired with heartbeat leases. The script reads counts only; it never renews a heartbeat, removes expired entries, advances the FIFO queue, or changes key expiry.
7. The API returns safe aggregate fields and separate inventory/queue observation times. Next.js renders the table. **Refresh snapshot** makes a normal GET request, so it works without client JavaScript.

The regular customer `getWaitingRoom` function is intentionally not reused here: a customer status request renews heartbeats, removes expired members, and can admit the next customer. Calling it from an operator dashboard would change customer behavior just by watching it.

## Interpret the numbers

| Field | Meaning |
| --- | --- |
| Available / booked / total seats | Committed PostgreSQL inventory counts; not seat holds. |
| Waiting customers | Accounts whose waiting heartbeat deadline is still in the future. |
| Active turns / capacity | Accounts whose checkout access has not expired, against the configured two-account limit. |
| Unknown | Redis did not answer within the bounded connection/command time. It does not mean zero. |

If one active turn expires while a customer is still waiting, the dashboard may show one active turn and one waiting customer. It will not fill the empty place itself. The next normal customer join/status request advances the room. A customer who already booked may still have an active turn until its fixed deadline.

The inventory timestamp marks the start of the inventory read; Redis supplies its own observation time. These are **separate snapshots**, not a distributed transaction. Counts can change after either read, and a show can start between them. The next refresh removes shows that have started. No historical traffic or latency measurements are stored in this phase.

If Redis fails, the operator endpoint still returns `200` with `queueStatus: "unavailable"`, `queueObservedAt: null`, and null queue counts. PostgreSQL counts remain visible with a warning. This exception is appropriate for observation: customer joins and new bookings still fail closed under the existing Redis-failure rules. PostgreSQL/authentication failures do not become successful empty snapshots.

## Read these files in order

| File | What to understand |
| --- | --- |
| `apps/api/prisma/schema.prisma` and new migration | Database role default and ordered-show index; previous migrations stay unchanged. |
| `apps/api/prisma/set-operator.ts` | Explicit local role changes, validation, and cleanup. |
| `apps/api/src/routes/operations.ts` | Authentication versus authorization; role checked on every request. |
| `apps/api/src/operations.ts` | Bounded consistent inventory read and non-mutating Redis snapshot. |
| `apps/api/src/app.ts` | New route registration and no-store responses, including errors. |
| `apps/web/src/lib/operations.ts` | Server-only data contract and operator denial handling. |
| `apps/web/src/lib/return-to.ts` | Exact `/operations` login-return allowlist entry; arbitrary redirects remain blocked. |
| `apps/web/src/app/operations/page.tsx` and `globals.css` | Server-rendered access, empty, normal, and degraded states; keyboard-scrollable table. |
| `apps/api/tests/operations.test.ts` | Real PostgreSQL/Redis checks across independent API processes. |
| Root/API `package.json` and `README.md` | New role command, test command, and current setup. |

No dependency was added.

## Verification commands

```powershell
npm run test:operations
npm run test:auth
npm run test:bookings
npm run test:waiting-room
npm run test:request-limits
npm run typecheck
npm run build
```

Integration tests require the local database and Redis. They start their own APIs, use unique synthetic accounts/shows, and clean only their fixtures. Operations tests cover unauthenticated/customer denial, signup role injection, CLI grant/revoke with existing sessions, real booking totals, shared queue counts, expired-member exclusion without mutation, bounded results, and a private simulated Redis outage. No shared Redis shutdown or database reset is needed.

The read script is batched for the current standalone Redis instance. Its keys span show hash tags; Redis Cluster would require grouping reads by show/slot. This is not a production monitoring platform: there is no historical telemetry, alerting, dashboard-specific throttling, role audit log, or pagination beyond the first 50 shows. Role revocation is enforced at the next authorization check; it cannot retract a response already in progress.

## Learning exercise and checkpoint

1. Open `/operations` while signed out. Sign in as an ordinary customer and explain why login succeeds but access is denied.
2. Grant your intended account the operator role. In separate browser profiles, join the same show as three customers. Refresh the dashboard: expect two active turns and one waiting customer, if their deadlines are still live.
3. Book one seat as an admitted customer. Refresh and explain why booked seats increase but active turns need not decrease.
4. Revoke your operator role and refresh using the same session. Explain why the API checks the current database role rather than trusting a role saved in the browser.
5. Small code exercise: add a derived `soldOut` label using `availableSeats === 0`. Decide whether it belongs in the page or API, and explain your choice. Do not change queue membership to produce it.

Be able to answer: Why is authentication alone insufficient? Why can a dashboard read safely degrade when booking admission cannot? Why are PostgreSQL and Redis counts not one atomic snapshot? Why would reusing `getWaitingRoom` make this dashboard incorrect?

Review the diff and commit it yourself once these points are clear. Stop here; Phase 10 begins only when you are ready.