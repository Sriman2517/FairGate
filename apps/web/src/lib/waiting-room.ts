import "server-only";
import { AuthenticationRequired, bookingRequest } from "./bookings";
import type { WaitingRoomResult } from "./waiting-room-types";
import { retryAfterSeconds } from "./retry-after";

export async function readWaitingRoom(showId: unknown, operation: "join" | "status" | "leave" = "status"): Promise<WaitingRoomResult> {
  if (typeof showId !== "string" || showId.length > 120 || !/^[A-Za-z0-9-]+$/.test(showId)) {
    return { error: "Choose a show and try again.", closed: true };
  }
  try {
    const response = await bookingRequest(`/waiting-room/${encodeURIComponent(showId)}${operation === "status" ? "" : `/${operation}`}`, {
      method: operation === "status" ? "GET" : "POST",
    });
    if (response.ok) return response.json();
    const data: { error: { code: string } } = await response.json();
    if (data.error.code === "TOO_MANY_REQUESTS") return {
      error: "You’re checking too frequently. Please pause and keep just one waiting-room tab open.",
      retryAfterSeconds: retryAfterSeconds(response),
    };
    if (data.error.code === "SHOW_STARTED") return { error: "This show has started. Booking is closed.", closed: true };
    if (data.error.code === "SHOW_SOLD_OUT") return { error: "This show has no available seats. Please choose another showtime.", closed: true };
    if (response.status === 404) return { error: "This show is no longer available.", closed: true };
    if (data.error.code === "WAITING_ROOM_FULL") return { error: "The waiting room is full. Please try again shortly." };
    return { error: operation === "leave" ? "We could not confirm that you left. Check your turn and try again." : "We could not check your turn. Please try again shortly." };
  } catch (error) {
    if (error instanceof AuthenticationRequired) return { error: "Sign in again to check your turn.", signInRequired: true };
    return { error: "The waiting room is unavailable. Please try again shortly." };
  }
}
