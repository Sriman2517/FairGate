import "server-only";
import { cookies } from "next/headers";
import { readWaitingRoom } from "./waiting-room";

export const bookingIntentCookie = "fairgate_booking_intent";

// Called only from explicit POST actions, including completion of sign-in.
export async function enterBooking(showId: string) {
  const result = await readWaitingRoom(showId, "join");
  const destination = `/shows/${encodeURIComponent(showId)}`;
  if (result.signInRequired) {
    (await cookies()).set(bookingIntentCookie, showId, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
    });
    return `/login?returnTo=${encodeURIComponent(destination)}`;
  }
  // The query displays a fixed message. GET never consumes or executes an intent.
  return result.error ? `${destination}?entry=unavailable` : destination;
}
