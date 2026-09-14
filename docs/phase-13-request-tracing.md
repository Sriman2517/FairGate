# Phase 13: request IDs and structured API logs

## Outcome

Every request that reaches the API middleware gets a server-generated `X-Request-ID` response header. When its response finishes or the connection closes early, the API writes one JSON log line containing a small, explicit set of diagnostic fields.

This gives you a way to connect an API response to its method, route template, status, and elapsed time. It adds no dependency, migration, dashboard, or external logging service.

## Try it

Run the API from the repository root:

```powershell
npm run dev:api
```

In another PowerShell terminal, make a database-independent liveness request:

```powershell
$healthResponse = Invoke-WebRequest http://127.0.0.1:4000/health
$healthResponse.Headers['X-Request-ID']
```

Find the JSON line in the API terminal with that same ID. Make the request again: it must have a different ID. You can also use `curl.exe -i http://127.0.0.1:4000/health` to see the header directly.

For an unauthorized request, use `curl.exe -i http://127.0.0.1:4000/bookings`. It should return 401 with an ID and log a completed 401 response. Do not paste real bearer tokens, cookies, or passwords into logs or screenshots.

## Follow one request

1. The logging middleware runs before routes and JSON body parsing. It creates a UUID and starts a monotonic timer, then sets `X-Request-ID` on the response. Incoming `X-Request-ID` values are ignored; callers cannot choose another request's diagnostic ID or inject a secret through that header.
2. A route-group middleware records a literal prefix such as `/bookings`. The API then performs its existing authentication, validation, rate limit, queue operation, or database work.
3. On response `finish`, the logger reads the final HTTP status and the declared Express route pattern. A request for `/bookings/<actual-booking-id>` becomes `/bookings/:bookingId`, keeping the actual ID and any query string out of the log.
4. If parsing fails before a route handler is selected, the logger uses a group fallback such as `/auth/*`. An unmatched URL becomes `unmatched`. Neither fallback copies raw input into the route label.
5. The logger writes one JSON line to standard output. `finish` is normally followed by `close`; a per-request flag prevents two records for the same response.
6. If `close` occurs before response completion, the outcome is `aborted` and the status is null. This avoids treating Node's default status 200 as a successful response when the response never finished.

The unexpected-error handler continues to send its existing generic 500 response. The completion record captures that status and request ID. It no longer prints an uncorrelated error-name line. Error objects, messages, and stack traces are excluded from these request logs.

## Fields and their limits

| Field | Meaning |
| --- | --- |
| `event` | Always `http_request`. |
| `timestamp` | UTC time when the log entry is created. |
| `requestId` | UUID identifying one API HTTP attempt; matches its response header when headers reach the caller. |
| `method` | A standard HTTP method, or `OTHER`. |
| `route` | Server-defined mount prefix and route template, group wildcard, or `unmatched`. |
| `statusCode` | Completed response status, or null when aborted. |
| `durationMs` | Monotonic elapsed time through response completion/early close, rounded to two decimals. |
| `outcome` | `completed` or `aborted`. |

Only these fields are recorded. The logger does not serialize the request or error objects. It excludes authorization/cookie headers, passwords, bodies, query strings, IP addresses, customer IDs, and actual booking/show IDs. A route label is low-cardinality: many bookings use the same `/bookings/:bookingId` label.

The queue route intentionally uses the existing optional-operation template `/waiting-room/:showId{/:operation}`. Its parameters are not expanded. Use the request ID to locate a particular call; these logs do not distinguish join from leave by adding parameter values.

`completed` means the server finished writing its response, not that the browser received or acted on every byte. A 401, 409, 429, or 500 can all be completed responses. `aborted` means the response ended early; it cannot reliably distinguish a client disconnect from a server/network interruption. A request rejected by Node's HTTP parser before Express middleware runs has no application trace entry.

## Request ID versus booking request ID

These IDs solve different problems:

- The response header `X-Request-ID` identifies one HTTP attempt for diagnosis. Every attempt gets a fresh value.
- A booking's body field `requestId` is the existing idempotency key. Retrying the same booking intention keeps that value so the API returns the original booking.

Ten retries of one successful booking should therefore have ten diagnostic response IDs and one booking idempotency key. Diagnostic IDs never grant admission, identify an account, or authorize a booking.

## Boundaries of this phase

The ID belongs to the API response. Next.js currently makes API calls on the server and does not forward this header into its browser response or display it in the UI. Use direct API requests and API logs for this phase's exercise; this is not end-to-end distributed tracing across browser, Next.js, API, Redis, and PostgreSQL.

There is no log database, retention/rotation policy, aggregation, alerting, sampling, or latency dashboard. Standard-output collection depends on how you run the application. Logging is best-effort: a synchronous log-writer failure is caught so it cannot crash a completed HTTP request. Lost output is not recovered. Writing a line per request has overhead, so keep logging configuration consistent when comparing traffic experiments.

No new testing-only route is exposed in FairGate. The disconnect/error cases are exercised using a small isolated Express test app with the same middleware.

## Files to read

| File | Purpose |
| --- | --- |
| `apps/api/src/request-logging.ts` | Record allowlist, route-group labels, generated IDs, response lifecycle, and single-entry guard. |
| `apps/api/src/app.ts` | Middleware order, fixed group prefixes, and removal of the uncorrelated error log. |
| `apps/api/tests/request-logging.test.ts` | Real HTTP checks for completion, sensitive-input exclusion, errors, parallel IDs, aborts, and log-writer failure. |
| Root/API `package.json` | New `test:tracing` command and inclusion in `npm test`. |
| `README.md` and this guide | Current phase and learning checkpoint. |

The existing GitHub workflow calls `npm run check`, so the new suite is included automatically. No workflow duplication is needed.

## Verify

```powershell
npm run test:tracing
npm run check
```

Tracing tests start their own HTTP server and need no PostgreSQL/Redis. The full check still needs the local services and migrations. Its integration tests now run through the logging middleware too.

## Learning exercise and checkpoint

Send a request to an unknown URL containing a fake email in the path and a fake token in its query string. Find its response ID in the API output and confirm that the route label is `unmatched` and neither fake value is present.

Then compare a successful request, an unauthorized request, and a successful booking retry. Explain why each gets a new diagnostic ID and why that does not change the booking's idempotency behavior. Trace why malformed JSON still gets logged despite never reaching the route handler.

Review the changes and commit them yourself once this flow is clear. Stop here; Phase 14 starts only when you are ready.
