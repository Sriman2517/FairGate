"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { visitWaitingRoom } from "../app/actions/waiting-room";
import type { Seat } from "../lib/bookings";
import type { WaitingRoomResult } from "../lib/waiting-room-types";
import { turnSecondsRemaining, waitingRoomView } from "../lib/waiting-room-view";
import { BookingForm } from "./booking-form";
import { useRetryDelay } from "./use-retry-delay";

export function WaitingRoom({ showId, movieId, seats, priceInPaise, initialRequestId, initialResult }: {
  showId: string; movieId: string; seats: Seat[]; priceInPaise: number; initialRequestId: string; initialResult: WaitingRoomResult;
}) {
  const [result, action, pending] = useActionState(visitWaitingRoom, initialResult);
  const retryDelay = useRetryDelay(result);
  const [, startTransition] = useTransition();
  const room = result.waitingRoom;
  const [countdown, setCountdown] = useState({ snapshot: room, seconds: turnSecondsRemaining(room) });
  // A new snapshot must not inherit zero from a previous, expired turn.
  const remaining = countdown.snapshot === room ? countdown.seconds : turnSecondsRemaining(room);
  const view = waitingRoomView(result, remaining);
  const admitted = view === "admitted";
  const canJoin = view === "not_joined" || view === "expired";
  const heading = {
    admitted: "It’s your turn",
    waiting: "Please wait for your turn",
    not_joined: "Your seats are one step away",
    expired: "Your checkout turn has ended",
    closed: "Booking is closed",
    sign_in: "Sign in to continue",
    unavailable: "We couldn’t check your turn",
  }[view];

  useEffect(() => {
    if (room?.status !== "admitted") return;
    // Use elapsed time from the server snapshot, not the customer's wall clock.
    const received = performance.now();
    const update = () => setCountdown({ snapshot: room, seconds: turnSecondsRemaining(room, performance.now() - received) });
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [room]);

  useEffect(() => {
    if (pending || result.closed || result.signInRequired || room?.status === "not_joined") return;
    // Chain one check after the previous response; no overlapping polling requests.
    const timer = setTimeout(() => {
      const data = new FormData(); data.set("showId", showId); data.set("operation", "status");
      startTransition(() => action(data));
    }, result.retryAfterSeconds ? result.retryAfterSeconds * 1000 : room?.pollAfterMs ?? 5000);
    return () => clearTimeout(timer);
  }, [action, pending, result, room, showId]);

  return (
    <>
      <section className="waiting-room" aria-labelledby="waiting-room-heading">
        <h3 id="waiting-room-heading" aria-live="polite" aria-atomic="true">{heading}</h3>
        {result.notice && <p role="status">{result.notice}</p>}
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {retryDelay > 0 && <p>Checking resumes in {retryDelay} seconds. Your place or checkout turn may expire during this pause.</p>}
        {view === "waiting" && <>
          <p className="queue-position" role="status">{room?.position === 1 ? "You’re next in line" : `Your position: ${room?.position}`}</p>
          <p>Keep this page open. Your position updates automatically as checkout turns become available.</p>
          <p className="field-help">If this page cannot check in for a minute, your place expires. A turn does not guarantee a seat.</p>
        </>}
        {admitted && <>
          <p>You have up to 2 minutes to choose your seats and confirm. We’ll let you know when time is running low.</p>
          <details className="turn-details"><summary>Time left</summary><p className="turn-countdown"><strong role="timer" aria-live="off">{Math.floor(remaining! / 60)}:{String(remaining! % 60).padStart(2, "0")}</strong></p></details>
          {remaining! <= 30 && <p className="time-warning" role="status">Please confirm soon — less than 30 seconds remain before your checkout turn expires.</p>}
        </>}
        {canJoin && <p>{view === "expired"
          ? "Your checkout turn expired. Check My bookings if you just confirmed; otherwise book tickets to get another turn."
          : "Choose Book tickets to continue. If checkout is busy, we’ll save your place in line automatically."}</p>}
        {result.signInRequired ? <Link className="button" href={`/login?returnTo=${encodeURIComponent(`/shows/${showId}`)}`}>Sign in again</Link>
          : !result.closed && <form action={action} className="queue-controls">
            <input type="hidden" name="showId" value={showId} />
            <button className={`button ${!canJoin && view !== "unavailable" ? "manual-refresh" : ""}`} name="operation" value={canJoin ? "join" : "status"} disabled={pending || retryDelay > 0}>
              {pending ? "Updating…" : retryDelay > 0 ? "Please wait" : view === "expired" ? "Book tickets again" : canJoin ? "Book tickets" : "Check my turn"}
            </button>
            {(view === "waiting" || admitted) && <button className="button button-secondary" name="operation" value="leave" disabled={pending || retryDelay > 0}>
              {admitted ? "Leave checkout" : "Leave waiting room"}
            </button>}
          </form>}
        {(view === "waiting" || admitted) && <p>If you leave, rejoining puts you at the back of the line. Leaving does not cancel a booking.</p>}
        {view === "unavailable" && <p>Seat selection is paused until we can check your turn. We’ll try again automatically while this page stays open.</p>}
        {result.closed && <p><Link className="button" href={`/movies/${encodeURIComponent(movieId)}`}>Choose another showtime</Link></p>}
        <noscript><style>{`.manual-refresh { display: inline-flex !important; }`}</style><p>Use “Check my turn” every few seconds to keep your place. After a request-limit pause, wait the displayed time and reload this page.</p></noscript>
      </section>
      {/* Stay mounted so an uncertain booking retry retains its request ID. */}
      <div>
        <BookingForm showId={showId} seats={seats} priceInPaise={priceInPaise} turnId={room?.turnId ?? null} initialRequestId={initialRequestId} enabled={admitted} />
      </div>
      {!admitted && <>
        <div className="seat-map-scroll" role="region" aria-label="Seat availability preview. Scroll horizontally if needed." tabIndex={0}>
          <div className="seat-grid">
            {seats.map((seat) => <span key={seat.label} className={seat.available ? "seat" : "seat seat-booked"}
              aria-label={`Seat ${seat.label}, ${seat.available ? "available" : "booked"}`}>{seat.label}</span>)}
          </div>
        </div>
        <p className="seat-scroll-hint">On a small screen, scroll across to see every seat.</p>
        <p className="seat-legend"><span>□ Available</span><span>× Booked</span></p>
        {!result.closed && <p className="booking-status">Seat selection opens when it’s your turn. A place in line does not hold a seat.</p>}
        <p className="booking-status"><Link href="/bookings">Check My bookings</Link></p>
      </>}
    </>
  );
}
