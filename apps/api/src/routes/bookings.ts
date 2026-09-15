import { Router, type Response } from "express";
import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { currentUser } from "../auth/sessions.js";
import { bookingFields, isUuid, publicBooking, readBookingInput } from "../bookings.js";
import { getWaitingRoom } from "../waiting-room.js";
import { enforceRequestLimit } from "../request-limits.js";
import { releaseBookingTurn } from "../booking-release.js";

export const bookingsRouter = Router();
function fail(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ error: { code, message } });
}
type Input = NonNullable<ReturnType<typeof readBookingInput>>;
async function replayIfPresent(userId: string, input: Input, response: Response) {
  const existing = await prisma.booking.findUnique({
    where: { userId_requestId: { userId, requestId: input.requestId } }, select: bookingFields,
  });
  if (!existing) return false;
  if (existing.showId !== input.showId || JSON.stringify(existing.seats.map((seat) => seat.seatLabel)) !== JSON.stringify(input.seatLabels)) {
    fail(response, 409, "REQUEST_ID_REUSED", "This request ID already belongs to a different selection. Choose seats again.");
  } else {
    await releaseBookingTurn(existing.id);
    response.status(200).json({ booking: publicBooking(existing) });
  }
  return true;
}
bookingsRouter.post("/", async (request, response) => {
  const user = await currentUser(request);
  if (!user) { fail(response, 401, "UNAUTHENTICATED", "Sign in to book tickets."); return; }
  const input = readBookingInput(request.body);
  if (!input) { fail(response, 400, "INVALID_INPUT", "Choose 1 to 6 distinct seats and provide a show ID and UUID request ID."); return; }
  // Replays work after expiry, sellout, and Redis outages.
  if (await replayIfPresent(user.id, input, response)) return;
  await enforceRequestLimit(user.id, "booking");
  const seats = await prisma.showSeat.findMany({
    where: { showId: input.showId, label: { in: input.seatLabels } },
    select: { show: { select: { startsAt: true, priceInPaise: true, currency: true } } },
  });
  if (seats.length !== input.seatLabels.length) { fail(response, 404, "SEAT_NOT_FOUND", "A selected seat does not exist for this show."); return; }
  const show = seats[0]!.show;
  if (show.startsAt <= new Date()) { fail(response, 409, "SHOW_STARTED", "This show has already started."); return; }
  const admission = await getWaitingRoom(user.id, input.showId, show.startsAt);
  if (admission.status !== "admitted" || !admission.turnId || (input.turnId && input.turnId !== admission.turnId)) {
    // A concurrent identical request may just have committed and released its turn.
    if (await replayIfPresent(user.id, input, response)) return;
    fail(response, 403, "ADMISSION_REQUIRED", "Your checkout turn has ended. Check My bookings before booking again."); return;
  }
  try {
    // Nested writes are one transaction: all seats, the ticket, and the release job commit together.
    const booking = await prisma.booking.create({ data: {
      userId: user.id, showId: input.showId, requestId: input.requestId, turnId: admission.turnId,
      priceInPaise: show.priceInPaise * input.seatLabels.length, currency: show.currency,
      seats: { create: input.seatLabels.map((seatLabel) => ({ seatLabel, priceInPaise: show.priceInPaise })) },
      release: { create: { userId: user.id, showId: input.showId, turnId: admission.turnId, startsAt: show.startsAt } },
    }, select: bookingFields });
    await releaseBookingTurn(booking.id);
    response.status(201).json({ booking: publicBooking(booking) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (await replayIfPresent(user.id, input, response)) return;
      const used = await prisma.booking.findUnique({ where: { turnId: admission.turnId }, select: { id: true } });
      fail(response, 409, used ? "TURN_USED" : "SEAT_UNAVAILABLE", used
        ? "This checkout turn already completed a booking. Check My bookings."
        : "Some selected seats were just booked. None of your selection was booked. Please choose again.");
      return;
    }
    throw error;
  }
});
bookingsRouter.get("/", async (request, response) => {
  const user = await currentUser(request);
  if (!user) { fail(response, 401, "UNAUTHENTICATED", "Sign in to see your bookings."); return; }
  const bookings = await prisma.booking.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: bookingFields });
  response.status(200).json({ bookings: bookings.map(publicBooking) });
});
bookingsRouter.get("/:bookingId", async (request, response) => {
  const user = await currentUser(request);
  if (!user) { fail(response, 401, "UNAUTHENTICATED", "Sign in to see your booking."); return; }
  const id = request.params.bookingId;
  const booking = isUuid(id) ? await prisma.booking.findFirst({ where: { id, userId: user.id }, select: bookingFields }) : null;
  if (!booking) { fail(response, 404, "BOOKING_NOT_FOUND", "Booking not found."); return; }
  response.status(200).json({ booking: publicBooking(booking) });
});
