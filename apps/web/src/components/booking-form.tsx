"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { bookSeat } from "../app/actions/bookings";
import type { Seat } from "../lib/bookings";
import { formatPrice } from "../lib/format";
import { useRetryDelay } from "./use-retry-delay";

export function BookingForm({ showId, seats, priceInPaise, turnId, initialRequestId, enabled = true }: {
  showId: string; seats: Seat[]; priceInPaise: number; turnId: string | null;
  initialRequestId: string; enabled?: boolean;
}) {
  const [selection, setSelection] = useState<{ labels: string[]; requestId: string; turnId: string | null }>({ labels: [], requestId: initialRequestId, turnId });
  const [state, action, pending] = useActionState(bookSeat, { error: "" });
  const retryDelay = useRetryDelay(state);
  const sameRequest = !state.requestId || state.requestId === selection.requestId;
  const uncertain = sameRequest && state.uncertain;
  const selectedAvailable = selection.labels.length > 0 && selection.labels.every((label) => seats.some((seat) => seat.label === label && seat.available));
  const selectionCurrent = selection.turnId === turnId;
  function toggle(label: string) {
    setSelection((previous) => ({
      labels: (previous.labels.includes(label) ? previous.labels.filter((seat) => seat !== label) : [...previous.labels, label]).sort(),
      requestId: crypto.randomUUID(), turnId,
    }));
  }
  const total = priceInPaise * selection.labels.length;
  return <form className="booking-form" action={action} hidden={!enabled && !uncertain}>
    <input type="hidden" name="showId" value={showId} />
    <input type="hidden" name="requestId" value={selection.requestId} />
    <input type="hidden" name="turnId" value={selection.turnId ?? ""} />
    {selection.labels.map((label) => <input key={label} type="hidden" name="seatLabels" value={label} />)}
    <fieldset className="seat-fieldset" disabled={!enabled || pending || uncertain || state.showStarted}>
      <legend>Choose up to 6 seats</legend>
      <div className="cinema-screen">ALL EYES THIS WAY</div>
      <div className="seat-map-scroll" role="region" aria-label="Cinema seats. Scroll horizontally if needed." tabIndex={0}>
        <div className="seat-grid">{seats.map((seat) => <label className="seat-choice" key={seat.label}>
          <input type="checkbox" checked={selection.labels.includes(seat.label)}
            disabled={!seat.available || (!selection.labels.includes(seat.label) && selection.labels.length >= 6)}
            onChange={() => toggle(seat.label)} aria-label={`Seat ${seat.label}, ${seat.available ? "available" : "booked"}`} />
          <span className={seat.available ? "seat" : "seat seat-booked"}>{seat.label}</span>
        </label>)}</div>
      </div>
    </fieldset>
    <p className="seat-scroll-hint">Scroll across to see every seat.</p>
    <p className="seat-legend"><span>□ Available</span><span>■ Selected</span><span>× Booked</span></p>
    <div className="booking-summary" aria-live="polite">
      <div><span className="summary-label">YOUR SEATS</span><p>{selection.labels.join(", ") || "Pick your favourite spot"}</p></div>
      <div><span className="summary-label">{selection.labels.length} × {formatPrice(priceInPaise)}</span><p>{formatPrice(total)}</p></div>
    </div>
    {!selectionCurrent && selection.labels.length > 0 && !uncertain && <p role="status">A new checkout turn has opened. Change your selection to confirm it for this turn.</p>}
    {sameRequest && state.error && <p className="form-error" role="alert">{state.error}</p>}
    {retryDelay > 0 && <p className="field-help">Retry in {retryDelay} seconds.</p>}
    <button className="button" disabled={pending || retryDelay > 0 || state.showStarted || (!uncertain && (!enabled || !selectionCurrent || !selectedAvailable))}>
      {pending ? "Confirming…" : uncertain ? "Retry same selection" : `Confirm demo booking · ${formatPrice(total)}`}
    </button>
    <p className="field-help">No payment required. Seats are reserved together only when confirmed.</p>
    <Link href="/bookings">View My bookings</Link>
  </form>;
}
