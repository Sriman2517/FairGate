import { Router, type Response } from "express";
import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { currentUser } from "../auth/sessions.js";
import { bookingFields, isUuid, publicBooking, readBookingInput } from "../bookings.js";

export const bookingsRouter = Router();

function fail(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ error: { code, message } });
}

type Input = NonNullable<ReturnType<typeof readBookingInput>>;

// Run before inserting AND after a concurrent unique-constraint conflict.
async function replayIfPresent(userId: string, input: Input, response: Response) {
  const existing = await prisma.booking.findUnique({
    where: { userId_requestId: { userId, requestId: input.requestId } },
    select: bookingFields,
  });
  if (!existing) return false;
  if (existing.showId !== input.showId || existing.seatLabel !== input.seatLabel) {
    fail(response, 409, "REQUEST_ID_REUSED", "This request ID already belongs to a different seat. Choose a seat again.");
  } else {
    response.status(200).json({ booking: publicBooking(existing) });
  }
  return true;
}

bookingsRouter.post("/", async (request, response) => {
  const user = await currentUser(request);
  if (!user) {
    fail(response, 401, "UNAUTHENTICATED", "Sign in to book a seat.");
    return;
  }
  const input = readBookingInput(request.body);
  if (!input) {
    fail(response, 400, "INVALID_INPUT", "Provide a show ID, seat label, and UUID request ID.");
    return;
  }

  // A successful retry still works if the show has since started or sold out.
  if (await replayIfPresent(user.id, input, response)) return;
  const seat = await prisma.showSeat.findUnique({
    where: { showId_label: { showId: input.showId, label: input.seatLabel } },
    select: { show: { select: { startsAt: true, priceInPaise: true, currency: true } } },
  });
  if (!seat) {
    fail(response, 404, "SEAT_NOT_FOUND", "This seat does not exist for this show.");
    return;
  }
  if (seat.show.startsAt <= new Date()) {
    fail(response, 409, "SHOW_STARTED", "This show has already started.");
    return;
  }

  try {
    // One INSERT is atomic. PostgreSQL, not the seat-map snapshot, decides who wins.
    const booking = await prisma.booking.create({
      data: {
        userId: user.id, ...input,
        priceInPaise: seat.show.priceInPaise, currency: seat.show.currency,
      },
      select: bookingFields,
    });
    response.status(201).json({ booking: publicBooking(booking) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (await replayIfPresent(user.id, input, response)) return;
      fail(response, 409, "SEAT_UNAVAILABLE", "Someone just booked this seat. Please choose another.");
      return;
    }
    throw error;
  }
});

bookingsRouter.get("/", async (request, response) => {
  const user = await currentUser(request);
  if (!user) {
    fail(response, 401, "UNAUTHENTICATED", "Sign in to see your bookings.");
    return;
  }
  const bookings = await prisma.booking.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: bookingFields,
  });
  response.status(200).json({ bookings: bookings.map(publicBooking) });
});

bookingsRouter.get("/:bookingId", async (request, response) => {
  const user = await currentUser(request);
  if (!user) {
    fail(response, 401, "UNAUTHENTICATED", "Sign in to see your booking.");
    return;
  }
  const id = request.params.bookingId;
  const booking = isUuid(id) ? await prisma.booking.findFirst({
    where: { id, userId: user.id },
    select: bookingFields,
  }) : null;
  if (!booking) {
    fail(response, 404, "BOOKING_NOT_FOUND", "Booking not found.");
    return;
  }
  response.status(200).json({ booking: publicBooking(booking) });
});
