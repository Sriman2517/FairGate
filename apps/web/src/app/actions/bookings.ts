"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthenticationRequired, bookingRequest, type Booking } from "../../lib/bookings";
import { retryAfterSeconds } from "../../lib/retry-after";

export type BookingState = { error: string; requestId?: string; uncertain?: boolean; showStarted?: boolean; retryAfterSeconds?: number };
export async function bookSeat(_previousState: BookingState, formData: FormData): Promise<BookingState> {
  const showId = formData.get("showId");
  const seatLabels = formData.getAll("seatLabels");
  const requestId = formData.get("requestId");
  const turnId = formData.get("turnId");
  if (typeof showId !== "string" || !/^[A-Za-z0-9-]{1,120}$/.test(showId) ||
      typeof requestId !== "string" || typeof turnId !== "string" || !turnId ||
      seatLabels.length < 1 || seatLabels.length > 6 || seatLabels.some((seat) => typeof seat !== "string")) {
    return { error: "Choose 1 to 6 available seats and try again." };
  }
  const uncertain = { error: "We could not confirm the result. Retry this same selection or check My bookings before starting again.", requestId, uncertain: true };
  let destination: string;
  try {
    const response = await bookingRequest("/bookings", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, seatLabels, requestId, turnId }) });
    if (!response.ok) {
      const data: { error: { code: string; message: string } } = await response.json();
      if (data.error.code === "TOO_MANY_REQUESTS") return { ...uncertain, error: "Please pause before retrying this selection.", retryAfterSeconds: retryAfterSeconds(response) };
      if (response.status >= 500) return uncertain;
      revalidatePath(`/shows/${showId}`);
      return { error: data.error.message, requestId, showStarted: data.error.code === "SHOW_STARTED" };
    }
    const data: { booking: Booking } = await response.json();
    destination = `/bookings/${encodeURIComponent(data.booking.id)}`;
  } catch (error) {
    if (error instanceof AuthenticationRequired) destination = `/login?returnTo=${encodeURIComponent(`/shows/${showId}`)}`;
    else return uncertain;
  }
  revalidatePath(`/shows/${showId}`);
  revalidatePath("/bookings");
  redirect(destination);
}
