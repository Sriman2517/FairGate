"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthenticationRequired, bookingRequest, type Booking } from "../../lib/bookings";
import { retryAfterSeconds } from "../../lib/retry-after";

export type BookingState = {
  error: string;
  seatLabel?: string;
  unavailableSeat?: string;
  showStarted?: boolean;
  retryAfterSeconds?: number;
};

export async function bookSeat(_previousState: BookingState, formData: FormData): Promise<BookingState> {
  const showId = formData.get("showId");
  const seatLabel = formData.get("seatLabel");
  const requestId = formData.get("requestId");
  if (typeof showId !== "string" || showId.length > 120 || !/^[A-Za-z0-9-]+$/.test(showId)
    || typeof seatLabel !== "string" || typeof requestId !== "string") {
    return { error: "Choose an available seat and try again." };
  }

  let destination: string;
  try {
    // Price and customer identity are supplied by the API, never by this form.
    const response = await bookingRequest("/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, seatLabel, requestId }),
    });
    if (!response.ok) {
      const data: { error: { code: string } } = await response.json();
      if (data.error.code === "TOO_MANY_REQUESTS") {
        return { error: "Too many booking attempts. Wait before retrying this seat, or check My bookings.", seatLabel,
          retryAfterSeconds: retryAfterSeconds(response) };
      }
      if (data.error.code === "ADMISSION_REQUIRED") {
        return { error: "Your checkout turn has ended. Check your turn above and rejoin the waiting room to continue.", seatLabel };
      }
      if (data.error.code === "WAITING_ROOM_UNAVAILABLE") {
        return { error: "We could not check your checkout turn. Retry the same seat, or check My bookings first.", seatLabel };
      }
      if (data.error.code === "SEAT_UNAVAILABLE") {
        revalidatePath(`/shows/${showId}`);
        return { error: "Someone booked that seat before you. Please choose another available seat.", seatLabel, unavailableSeat: seatLabel };
      }
      if (data.error.code === "SHOW_STARTED") {
        revalidatePath(`/shows/${showId}`);
        return { error: "This show has started, so booking is closed.", showStarted: true };
      }
      if (data.error.code === "REQUEST_ID_REUSED") {
        return { error: "This request was already used for another seat. Check My bookings before starting a new selection.", seatLabel };
      }
      if (response.status === 400 || response.status === 404) {
        return { error: "That show or seat is no longer available. Reload the page and choose again.", seatLabel };
      }
      return { error: "We could not confirm the result. Retry the same seat, or check My bookings first.", seatLabel };
    }
    const data: { booking: Booking } = await response.json();
    destination = `/bookings/${encodeURIComponent(data.booking.id)}`;
  } catch (error) {
    if (error instanceof AuthenticationRequired) {
      destination = `/login?returnTo=${encodeURIComponent(`/shows/${showId}`)}`;
    } else {
      // Retrying the same request ID lets the API return an already-created booking.
      return { error: "The booking service is unavailable. Retry the same seat, or check My bookings first.", seatLabel };
    }
  }

  revalidatePath(`/shows/${showId}`);
  revalidatePath("/bookings");
  // redirect() throws a Next.js control-flow signal; it must remain outside catch.
  redirect(destination);
}
