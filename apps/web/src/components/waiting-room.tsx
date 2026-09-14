"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { visitWaitingRoom } from "../app/actions/waiting-room";
import type { Seat } from "../lib/bookings";
import type { WaitingRoomResult } from "../lib/waiting-room-types";
import { BookingForm } from "./booking-form";
import { useRetryDelay } from "./use-retry-delay";

export function WaitingRoom({ showId, seats, price, initialRequestId, initialResult }: {
  showId: string; seats: Seat[]; price: string; initialRequestId: string; initialResult: WaitingRoomResult;
}) {
  const [result, action, pending] = useActionState(visitWaitingRoom, initialResult);
  const retryDelay = useRetryDelay(result);
  const [, startTransition] = useTransition();
  const [remaining, setRemaining] = useState<number | null>(null);
  const room = result.waitingRoom;
  const admitted = room?.status === "admitted" && remaining !== 0;

  useEffect(() => {
    if (!room?.expiresAt) { setRemaining(null); return; }
    // Use elapsed time from the server snapshot, not the customer's wall clock.
    const duration = new Date(room.expiresAt).getTime() - new Date(room.serverTime).getTime();
    const received = performance.now();
    const update = () => setRemaining(Math.max(0, Math.ceil((duration - (performance.now() - received)) / 1000)));
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
        <h3 id="waiting-room-heading">{admitted ? "It’s your turn" : "Your place in the waiting room"}</h3>
        {result.notice && <p role="status">{result.notice}</p>}
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {retryDelay > 0 && <p>Checking resumes in {retryDelay} seconds. Your place or checkout turn may expire during this pause.</p>}
        {room?.status === "waiting" && <>
          <p className="queue-position" role="status">{room.position === 1 ? "You’re next in line" : `Your position: ${room.position}`}</p>
          <p>Keep this page open. Your position updates automatically as checkout turns become available.</p>
          <p className="field-help">If this page cannot check in for a minute, your place expires. A turn does not guarantee a seat.</p>
        </>}
        {admitted && <p role="status">Your checkout turn lasts up to two minutes. Time remaining: <strong>{remaining ?? "…"} seconds</strong>.</p>}
        {(room?.status === "not_joined" || (room?.status === "admitted" && remaining === 0)) &&
          <p>Join to get a checkout turn. If your previous turn or waiting place expired, you’ll rejoin at the back of the line.</p>}
        {result.signInRequired ? <Link className="button" href={`/login?returnTo=${encodeURIComponent(`/shows/${showId}`)}`}>Sign in again</Link>
          : !result.closed && <form action={action} className="queue-controls">
            <input type="hidden" name="showId" value={showId} />
            <button className="button" name="operation" value={room?.status === "not_joined" ? "join" : "status"} disabled={pending || retryDelay > 0}>
              {pending ? "Checking…" : retryDelay > 0 ? "Please wait" : room?.status === "not_joined" ? "Join waiting room" : "Check my turn"}
            </button>
            {(room?.status === "waiting" || room?.status === "admitted") && <button className="button" name="operation" value="leave" disabled={pending || retryDelay > 0}>
              {admitted ? "Give up my turn" : "Leave waiting room"}
            </button>}
          </form>}
        {(room?.status === "waiting" || room?.status === "admitted") && <p>If you leave, rejoining puts you at the back of the line. Leaving does not cancel a booking.</p>}
        <noscript><p>Use “Check my turn” every few seconds to keep your place. After a request-limit pause, wait the displayed time and reload this page.</p></noscript>
      </section>
      {/* Stay mounted so an uncertain booking retry retains its request ID. */}
      <div hidden={!admitted}>
        <BookingForm showId={showId} seats={seats} price={price} initialRequestId={initialRequestId} enabled={admitted} />
      </div>
      {!admitted && <>
        <div className="seat-grid" aria-label="Seat availability preview">
          {seats.map((seat) => <span key={seat.label} className={seat.available ? "seat" : "seat seat-booked"}
            aria-label={`Seat ${seat.label}, ${seat.available ? "available" : "booked"}`}>{seat.label}</span>)}
        </div>
        <p className="seat-legend"><span>□ Available</span><span>× Booked</span></p>
        <p className="booking-status">Seat selection opens when it’s your turn. A place in line does not hold a seat.</p>
        <p className="booking-status"><Link href="/bookings">Check My bookings</Link></p>
      </>}
    </>
  );
}
