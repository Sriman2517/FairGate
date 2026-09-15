import { Prisma } from "./generated/prisma/client.js";

export const maxBookingSeats = 6;
// Only public fields leave this module; request IDs and customer IDs stay private.
export const bookingFields = {
  id: true, showId: true, priceInPaise: true, currency: true, createdAt: true,
  seats: { select: { seatLabel: true, priceInPaise: true }, orderBy: { seatLabel: "asc" } },
  show: { select: {
    movieId: true, movie: { select: { title: true, posterPath: true } },
    cinemaName: true, screenName: true, startsAt: true,
  } },
} as const;

type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingFields }>;
export function publicBooking(booking: BookingRecord) {
  const show = booking.show;
  return {
    id: booking.id, showId: booking.showId,
    seatLabel: booking.seats[0]?.seatLabel, // Compatibility with earlier single-seat clients.
    seatLabels: booking.seats.map((seat) => seat.seatLabel), seats: booking.seats,
    priceInPaise: booking.priceInPaise, currency: booking.currency, createdAt: booking.createdAt,
    show: { movieId: show.movieId, movieTitle: show.movie.title, posterPath: show.movie.posterPath,
      cinemaName: show.cinemaName, screenName: show.screenName, startsAt: show.startsAt },
  };
}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function readBookingInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { showId, seatLabel, seatLabels, requestId, turnId } = body as Record<string, unknown>;
  const labels = seatLabels ?? (seatLabel === undefined ? undefined : [seatLabel]);
  if (typeof showId !== "string" || !/^[A-Za-z0-9-]{1,120}$/.test(showId) ||
      !isUuid(requestId) || (seatLabels !== undefined && seatLabel !== undefined) ||
      !Array.isArray(labels) || labels.length < 1 || labels.length > maxBookingSeats ||
      !labels.every((label): label is string => typeof label === "string" && /^[A-Z][1-9]\d?$/.test(label)) ||
      new Set(labels).size !== labels.length ||
      (turnId !== undefined && (typeof turnId !== "string" || turnId.length < 1 || turnId.length > 160))) return null;
  return { showId, seatLabels: [...labels].sort(), requestId: requestId.toLowerCase(), turnId: turnId as string | undefined };
}
