import { Prisma } from "./generated/prisma/client.js";

// Private fields (customer ID and request ID) are never selected for responses.
export const bookingFields = {
  id: true, showId: true, seatLabel: true, priceInPaise: true, currency: true, createdAt: true,
  seat: { select: { show: { select: {
    movieId: true, movie: { select: { title: true } },
    cinemaName: true, screenName: true, startsAt: true,
  } } } },
} as const;

type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingFields }>;

export function publicBooking(booking: BookingRecord) {
  const show = booking.seat.show;
  return {
    id: booking.id,
    showId: booking.showId,
    seatLabel: booking.seatLabel,
    priceInPaise: booking.priceInPaise,
    currency: booking.currency,
    createdAt: booking.createdAt,
    show: {
      movieId: show.movieId, movieTitle: show.movie.title,
      cinemaName: show.cinemaName, screenName: show.screenName, startsAt: show.startsAt,
    },
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function readBookingInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { showId, seatLabel, requestId } = body as Record<string, unknown>;
  if (
    typeof showId !== "string" || showId.length < 1 || showId.length > 120 ||
    typeof seatLabel !== "string" || !/^[A-Z][1-9]\d?$/.test(seatLabel) ||
    !isUuid(requestId)
  ) return null;
  return { showId, seatLabel, requestId: requestId.toLowerCase() };
}
