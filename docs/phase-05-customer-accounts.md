# Phase 5: Customer accounts

FairGate can now register a customer, sign them in, show their account, and sign them out. This gives later booking work a trustworthy customer ID: the API will identify the customer from their session, rather than accepting an owner ID supplied by a form.

This phase adds PostgreSQL `User` and `Session` tables, four Express endpoints, and small Next.js pages. The movie catalogue remains available without signing in. Email verification, booking, and the waiting room come later.

## Read the code in this order

| File | What to understand |
| --- | --- |
| [schema.prisma](../apps/api/prisma/schema.prisma) and [migration.sql](../apps/api/prisma/migrations/20260913010000_add_customers_and_sessions/migration.sql) | One customer can have several sessions. The database enforces unique emails and the session-to-customer relationship. |
| [validation.ts](../apps/api/src/auth/validation.ts) | Turn untrusted request data into a small, validated input object. |
| [passwords.ts](../apps/api/src/auth/passwords.ts) | Hash a new password and verify a supplied password against a stored hash. |
| [sessions.ts](../apps/api/src/auth/sessions.ts) | Generate a session token, digest it, read a Bearer header, and find the current customer. |
| [API auth.ts](../apps/api/src/routes/auth.ts) and [app.ts](../apps/api/src/app.ts) | Follow each endpoint, its rate limits, and JSON/error handling. |
| [Web auth.ts](../apps/web/src/lib/auth.ts) | Read the browser cookie on the server and call the account API without caching its response. |
| [Server Actions](../apps/web/src/app/actions/auth.ts) | Submit credentials, set or remove the cookie, and redirect after success. |
| [auth-form.tsx](../apps/web/src/components/auth-form.tsx) and [account/page.tsx](../apps/web/src/app/account/page.tsx) | Connect forms to actions, show pending/errors, and protect the account page. |
| [auth.test.ts](../apps/api/tests/auth.test.ts) | Read examples of the promises the API must keep, including concurrent requests. |

## Follow one registration

1. Open `/register` and submit a name, email, and password. `AuthForm` calls the `register` Server Action; `useActionState` displays an error or disables the button while the request is pending.
2. The action picks the expected fields and sends JSON from the Next.js server to Express at `POST /auth/register`.
3. Express checks the request size, rate limit, and input. It trims the name and normalizes the email with `trim().toLowerCase()`.
4. The API hashes the password with Argon2id and generates a fresh random session token. A nested Prisma write creates the customer and their first session together: both succeed, or neither is saved.
5. Express returns the public customer fields and the raw token with its expiry. The token travels to the Next.js server, which places it in the `fairgate_session` cookie. The action returns no token to the form's state.
6. Next.js redirects to `/account`. The account page performs a fresh session check before showing the customer's name and email.

The database unique constraint resolves a race that an initial “does this email exist?” query cannot prevent. If two registrations for the same normalized email arrive together, one succeeds and the other receives `409 EMAIL_IN_USE`. Prisma's `P2002` error becomes that response.

The API constructs its database input explicitly. Adding a field such as `id` to a request does not let a caller choose the customer ID.

## Follow login, account lookup, and logout

**Login:** `/login` submits through a Server Action to `POST /auth/login`. The API normalizes the email, finds the customer, and verifies the password. An unknown email still runs Argon2 verification against a dummy hash. Unknown accounts and incorrect passwords receive the same `401 INVALID_CREDENTIALS` message. Success creates a new session, sets the cookie through Next.js, and redirects to `/account`.

**Current account:** the server-side `getCurrentUser()` reads the cookie and calls `GET /auth/me` with `Authorization: Bearer <token>`. Express hashes the supplied token, finds its session, checks expiry, and selects only `id`, `name`, and `email`. Missing, malformed, unknown, expired, or revoked sessions receive `401`; the page redirects to `/login`. An API outage is an error, rather than evidence that the customer has signed out.

**Logout:** the Server Action forwards the current token to `POST /auth/logout`. Express deletes that session row, then Next.js removes the cookie and redirects to `/login`. Repeating logout is safe: an already absent session still returns `204`. If backend revocation fails, the action shows an error and keeps the cookie so the customer can retry.

`redirect()` is outside the action's `try/catch` because Next.js implements it using a thrown control-flow signal. Catching that signal would turn a successful sign-in into an apparent error.

## Cookie and Bearer header are two transports

The browser sends its cookie to **Next.js**. Next.js reads that cookie on the server and sends a Bearer header to **Express**. Express does not read browser cookies in this design. The browser forms use Server Actions rather than calling Express directly.

The cookie is `HttpOnly`, so ordinary browser JavaScript cannot read it; this does not hide it from the browser's owner in developer tools. It has `SameSite=Lax`, a `/` path, and the session's expiry. In production it also has `Secure`, requiring HTTPS. Next.js's Server Action origin checks remain enabled.

The raw token stays out of client props, returned form state, URLs, and local storage. API account responses use `Cache-Control: no-store`; server-side auth fetches also use `cache: "no-store"` and a five-second timeout. The server checks `/auth/me` whenever the account page renders instead of treating the presence of a cookie as proof of authentication.

## Why passwords and session tokens use different hashes

People choose passwords that attackers may guess. Argon2id makes each guess consume time and memory and creates a salt automatically. This implementation uses 19 MiB of memory, two iterations, and parallelism of one. The encoded hash stores the parameters needed for verification; the plaintext password is never stored.

Session tokens are generated from 32 cryptographically random bytes, rather than chosen by a person. Express stores only a SHA-256 digest of each token. On a request, hashing the presented token again produces the database lookup key. A fast digest is suitable for this random secret; using it for human passwords would make password guessing cheap.

The token is an opaque credential. It contains no readable customer data or signed claims. The database session row supplies the customer relationship, expiry, and ability to revoke access.

## Expiry and validation rules

Each session expires **seven days after creation**. This is an absolute lifetime: browsing and account checks do not extend it. The cookie expiry helps the browser discard its token, while the API independently checks `Session.expiresAt`. Changing or keeping a cookie cannot bypass the server's expiry check.

Each successful login creates its own session. Signing out in one browser deletes that session; another browser's session continues to work. Deleting a customer cascades to their sessions. Expired sessions are rejected but their rows are not automatically cleaned up yet.

Registration accepts a trimmed name of 1–80 UTF-16 units, a normalized email of at most 254 units with basic syntax validation, and a password of 15–128 Unicode code points. Login accepts a password of 1–128 code points so an incorrect short password receives the normal credentials error. Password whitespace is preserved: adding or removing spaces changes the password.

`[...password].length` counts Unicode code points, which can differ from JavaScript string `.length` or the number of visible symbols. The form leaves password length enforcement to the API rather than using HTML length attributes with different counting rules. Browser validation improves feedback, but the API remains responsible for rejecting invalid data.

## API contract

All paths below are relative to `http://127.0.0.1:4000`. Registration and login expect JSON. `user` always contains only `id`, `name`, and `email`.

| Request | Input | Success | Expected rejection |
| --- | --- | --- | --- |
| `POST /auth/register` | `name`, `email`, `password` | `201 { user, session: { token, expiresAt } }` | `400 INVALID_INPUT`, `409 EMAIL_IN_USE`, `429 TOO_MANY_ATTEMPTS` |
| `POST /auth/login` | `email`, `password` | `200 { user, session: { token, expiresAt } }` | `400 INVALID_INPUT`, `401 INVALID_CREDENTIALS`, `429 TOO_MANY_ATTEMPTS` |
| `GET /auth/me` | Bearer token | `200 { user }` | `401 UNAUTHENTICATED` |
| `POST /auth/logout` | Current Bearer token, if present | `204`, no body | An unavailable database can prevent revocation. |

Errors have the shape `{ error: { code, message } }`. Malformed JSON receives `400 INVALID_JSON`; an auth body larger than 4 KiB receives `413 PAYLOAD_TOO_LARGE`. Unexpected failures return a generic `500 INTERNAL_SERVER_ERROR` without database details.

## Run and verify locally

Use Node.js 22.12 or later and Docker Desktop. From `C:\Users\bsrim\OneDrive\Desktop\FairGate`, with the Phase 4 local database configuration still in `apps/api/.env`, run:

```powershell
npm install
npm run db:start
npm run db:deploy
npm run db:generate
npm run typecheck
npm run test:auth
npm run build
```

`db:deploy` applies the new migration without resetting the existing catalogue. Keep the current local database and its data. A fresh checkout also needs the environment and catalogue seed setup described in the README.

Start the API and web app in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open `http://127.0.0.1:3000/register`. Use the development commands for this local HTTP walkthrough. `npm run build` checks the production build, but running the production web server sets `Secure` cookies; production authentication needs an HTTPS origin. Do not remove that flag to make an HTTP production setup work.

`test:auth` starts its own API on an available local port and uses real PostgreSQL. It refuses a database URL outside `127.0.0.1:5433/fairgate`. Every run creates synthetic accounts with unique email addresses and removes its own accounts and related sessions in cleanup. It does not reset the database or delete ordinary customer accounts.

The suite covers stored hashes, normalized and concurrent duplicate registration, malformed/oversized input, password whitespace, generic login errors, two-customer isolation, expired/revoked sessions, independent logins, database constraints, and rate limits. Request timeouts keep a stalled HTTP call from waiting indefinitely. The API tests do not replace checking the forms and cookies in a browser.

## Current limits to explain honestly

Registration and login share a limit of 60 attempts per backend IP per 15 minutes. Login also has a limit of 10 attempts per normalized email in that window; successful attempts count too. These counters live in the API process's memory and reset when it restarts.

All Next.js requests reach Express from the Next.js server's IP, so the first limit is shared by web customers. This is a coarse local safeguard, not a fair limit per visitor, a distributed limiter, or a bot-proof waiting room. Shared storage and carefully configured proxy identity belong to later work. The code does not trust arbitrary forwarded IP headers.

Email is an unverified account identifier in this phase. Registration does not prove ownership of the address or send mail. Duplicate registration also reveals that an address is registered, even though login uses a generic error. Password reset, email verification, expired-session cleanup, and account-management features remain outside this phase.

## Your exercise and checkpoint

Verification for this phase passed: API integration tests, type checking, the production build, browser registration/login/logout, and HTTP checks of cookie attributes and Server Action origin rejection. Argon2 is pinned to `0.44.0`, whose Windows binary loaded successfully on Node.js 22.12.0; `0.45.1` failed to load on this machine.

The dependency audit still reports four high-severity entries in the existing Prisma tooling chain (`prisma`, `@prisma/config`, `deepmerge-ts`, and `mysql2`). Their versions are unchanged from Phase 4. They require a separate dependency review; this phase does not apply npm's proposed breaking Prisma downgrade. The new authentication dependencies are not listed in that report.

Create a demo account with a long passphrase, then sign in to it in a second browser profile or private window. Sign out in the first window: reopening `/account` there should lead to login, while the second window should still show the account.

For a small code change, lower the login email limit from 10 to 3 and adjust the throttling test to match. Predict the status of the fourth attempt, run `npm run test:auth`, and explain why restarting the API resets the counter but does not erase database sessions. Restore the original value if you want to keep the current behavior.

Before committing, explain these without reading the implementation:

- Which component owns password verification, and why are frontend checks insufficient?
- Where is the raw session token, and what is stored in PostgreSQL?
- How does a request become associated with the correct customer?
- Why do simultaneous registrations still create only one account?
- Why does deleting a cookie alone leave a session valid, and what does our logout do first?
- Why does signing out in one window leave another browser's login working?
- What happens when the database is unavailable during account lookup or logout?

Review the diff, make any learning changes you want, and stage and commit it yourself when you can explain it. This is the Phase 5 stopping point.
