"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { bookSeat } from "../app/actions/bookings";
import type { Seat } from "../lib/bookings";
import { useRetryDelay } from "./use-retry-delay";

export function BookingForm({ showId, seats, price, initialRequestId, enabled = true }: {
  showId: string;
  seats: Seat[];
  price: string;
  initialRequestId: string;
  enabled?: boolean;
}) {
  const [selectedSeat, setSelectedSeat] = useState("");
  const [requestId, setRequestId] = useState(initialRequestId);
  const [state, action, pending] = useActionState(bookSeat, { error: "" });
  const retryDelay = useRetryDelay(state);
  const selectedAvailable = seats.some((seat) => seat.label === selectedSeat && seat.available)
    && state.unavailableSeat !== selectedSeat;

  function selectSeat(label: string) {
    if (label === selectedSeat) return;
    // A retry keeps its ID; choosing a different seat starts a different request.
    if (selectedSeat) setRequestId(crypto.randomUUID());
    setSelectedSeat(label);
  }

  return (
    <form className="booking-form" action={action}>
      <input type="hidden" name="showId" value={showId} />
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset className="seat-fieldset" disabled={!enabled || pending || state.showStarted}>
        <legend>Choose one seat</legend>
        <div className="seat-map-scroll" role="region" aria-label="Choose a cinema seat. Scroll horizontally if needed." tabIndex={0}>
          <div className="seat-grid">
            {seats.map((seat) => {
              const available = seat.available && state.unavailableSeat !== seat.label;
              return (
                <label className="seat-choice" key={seat.label}>
                  <input type="radio" name="seatLabel" value={seat.label} required
                    checked={selectedSeat === seat.label} disabled={!available}
                    onChange={() => selectSeat(seat.label)}
                    aria-label={`Seat ${seat.label}, ${available ? "available" : "booked"}`} />
                  <span className={available ? "seat" : "seat seat-booked"}>{seat.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </fieldset>
      <p className="seat-scroll-hint">On a small screen, scroll across to see every seat.</p>
      <p className="seat-legend"><span>□ Available</span><span>■ Selected</span><span>× Booked</span></p>
      <div className="booking-summary">
        <p aria-live="polite">{selectedSeat ? selectedAvailable ? `Selected seat: ${selectedSeat}` : `Seat ${selectedSeat} is no longer available. Choose another seat.` : "Choose one seat to continue."}</p>
        <p>One demo ticket · {price}</p>
      </div>
      {state.error && (!state.seatLabel || state.seatLabel === selectedSeat) && (
        <p className="form-error" role="alert">{state.error}</p>
      )}
      {retryDelay > 0 && <p className="field-help">You can retry in {retryDelay} seconds. Your checkout turn still has its original deadline.</p>}
      {retryDelay > 0 && <noscript><p>After waiting, check My bookings before reloading this page to try again.</p></noscript>}
      <button className="button" type="submit" disabled={!enabled || pending || retryDelay > 0 || !selectedAvailable || state.showStarted}>
        {pending ? "Confirming…" : retryDelay > 0 ? "Please wait" : `Confirm demo booking · ${price}`}
      </button>
      <p className="field-help">A selection does not hold a seat. Availability is checked when you confirm.</p>
      <p><Link href="/bookings">View My bookings</Link></p>
    </form>
  );
}
