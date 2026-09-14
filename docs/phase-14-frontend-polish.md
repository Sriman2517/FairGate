# Phase 14: clearer booking screens and mobile controls

## Outcome

Customers get a short explanation of the booking journey, a loading message during page navigation, clearer waiting-room states, and a direct route to other showtimes when booking closes. The eight-seat rows keep their physical order on small screens: a customer scrolls the seat map horizontally instead of tapping tiny controls or seeing seats rearranged into different rows.

The core flow remains sign in → explicitly join → wait for admission → choose one seat → confirm → My bookings. This phase does not change the API, database, queue capacity, or booking guarantees.

## Read these files in order

| File | What to understand |
| --- | --- |
| `apps/web/src/lib/waiting-room-view.ts` | Translate the latest API result and countdown into a display state. Errors and closure take priority over stale admission. |
| `apps/web/src/components/waiting-room.tsx` | Render that state, update the timer, poll sequentially, and keep the booking form mounted while hiding inactive checkout. |
| `apps/web/src/components/booking-form.tsx` | Retain the idempotency key when retrying the same seat; explain when a selection becomes unavailable. |
| `apps/web/src/app/shows/[showId]/page.tsx` | Render the initial seat snapshot, sign-in prompt, and sold-out/started-show recovery links. |
| `apps/web/src/app/page.tsx` | Explain the three booking steps in ordinary customer language. |
| `apps/web/src/app/loading.tsx` | Next.js streams this lightweight loading fallback while a page is being fetched; the shared header remains usable. |
| `apps/web/src/app/globals.css` | Responsive header, secondary leave button, countdown, and a keyboard-focusable horizontal seat region with at least 44 × 44 CSS-pixel seat controls. |
| `apps/web/src/components/auth-form.tsx` | Match the registration password length hint with browser validation; the server still validates submissions. |
| `apps/web/tests/waiting-room-view.test.ts` | Test deadline boundaries, fresh snapshots, invalid timestamps, error precedence, and waiting states. |
| Root and web `package.json`, `package-lock.json` | Add `test:ui` to the shared checks. The web workspace declares the same `tsx` test runner already used by the API. |

## Follow a customer request

1. Open a film and showtime. Next.js obtains a seat snapshot. Signed-out visitors see a sign-in link; a started or sold-out show offers **Choose another showtime**.
2. A signed-in customer with no queue membership sees **Ready to join?** and explicitly submits **Join waiting room**. The existing Server Action calls the API.
3. A `waiting` response shows **You’re in line** and the current position. An `admitted` response shows **It’s your turn**, the countdown, and the seat form. A queue position is not a promised wait duration or reserved seat.
4. The timer starts with `expiresAt - serverTime` and subtracts elapsed `performance.now()` time. It does not compare the server deadline with the customer's device clock. A new response starts a new snapshot; it must not inherit zero from an earlier expired turn.
5. At zero, the local display hides and disables checkout immediately, before the next poll. **Rejoin waiting room** sends an explicit join. Background status polling never joins automatically. If a status response has already changed to `not_joined`, the normal join prompt explains rejoining after expiry.
6. If a check fails, needs sign-in, or says booking is closed, those conditions override any stale admission. An unavailable check pauses selection and retries automatically; a request-limit response retains its existing cooldown. No stale snapshot authorizes a booking.
7. Choosing a seat and submitting still goes through the existing API admission check and database uniqueness constraint. A seat conflict refreshes availability and now also identifies the unavailable selection in the summary. An uncertain result still suggests retrying the same seat or checking My bookings.

The countdown is an approximate display: transport/hydration delays can make it slightly late. The API remains authoritative about turn expiry. These tests do not claim that a browser timer enforces backend admission.

## Accessibility and small-screen choices

- Page loading and changes to the waiting-room heading are announced politely. The countdown has `role="timer"` and `aria-live="off"`, so it does not interrupt a screen reader every second. A separate message appears when 30 seconds or less remain.
- Seat maps retain eight columns and use a scrollable region on narrow screens. Tab to the region and use horizontal arrow keys to scroll; tab into available radio choices and use their normal arrow-key selection. Booked seats have a text label and a strikethrough, and are disabled.
- Leaving the queue uses a secondary button; joining/checking remains the primary action. On narrow screens, the queue buttons stack.
- The header wraps on small screens. Existing sign-in, empty-booking, confirmation, and operator pages inherit the common layout improvements.
- No animations, external fonts, poster downloads, or additional UI framework are introduced.

## Run the checks

From the repository root:

```powershell
npm install
npm run test:ui
npm run db:start
npm run check
```

`test:ui` runs five pure display-state tests without databases. `check` includes them alongside the existing API regression suites, type checks, and both production builds. These state tests are not browser interaction or visual tests.

The Phase 14 implementation passed all 59 individual test cases, type checks, and both builds. Separate local HTTP checks exercised registration and the return path, joining, booking confirmation, retry recovery, seat conflicts, booking lists, and sold-out/started-show links. Their temporary accounts and shows were removed afterward.

With the loading boundary, Next.js can start streaming a page before deciding to redirect. A signed-out `/bookings` request can therefore return HTTP 200 with a redirect meta tag to sign-in instead of a 307. The protected booking data is still absent; progressive-enhancement form submissions still use 303 redirects. This behavior is covered by the HTTP check and documented in the installed Next.js redirect guide.

To try the site, start each development server in its own terminal:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open `http://127.0.0.1:3000`.

## Review checklist

1. At desktop width, read the three steps on the homepage and follow a film to its showtime. Try a signed-out show page, then register or sign in and return to the same show.
2. At 320 px and 390 px widths, check that navigation and buttons fit. Scroll the seat region to column eight, select a seat, and confirm. The page itself should not need horizontal scrolling.
3. Use keyboard-only navigation: skip link, main navigation, join, seat region, radio choices, confirm. Verify focus outlines and clear labels. With a screen reader, confirm the countdown does not announce every second.
4. Use three separate accounts/browser profiles for one future show. Two accounts can hold checkout turns; the third waits. Give up one turn and watch the waiting account become admitted. Separate tabs with the same account share one place.
5. Let a checkout turn expire without confirming. Verify selection closes, and explicitly rejoin. Refreshing status alone must not silently join again.
6. Have two admitted customers select the same available seat. Confirm one, then submit the other. The second customer should see a conflict, an unavailable selection summary, and refreshed seats.
7. Open a started or sold-out show and follow **Choose another showtime**. Review the empty My bookings page and a confirmed ticket. An operator should still be able to inspect the existing dashboard.
8. Use browser network throttling to observe the loading fallback. During a temporary service interruption, check the recovery message rather than assuming an old seat map is current. Do not stop shared services while tests or another task are using them.

HTTP form checks can validate server-rendered content and Server Actions, but they cannot establish mobile appearance, touch behavior, focus movement, hydration, or screen-reader announcements. Complete those visual and assistive-technology checks in your browser before calling the UI fully reviewed.

## Small exercise

Change the low-time warning from 30 seconds to 20 seconds, update its wording, and find the exact condition that controls it. Then explain why this change must not modify Redis admission rules or the booking idempotency key.

Pause here. Review the diff and guide, ask questions, and commit Phase 14 yourself when the code is clear. The proposed next phase is deployment readiness; do not start it as part of this phase.
