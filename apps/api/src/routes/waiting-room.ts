import { Router } from "express";
import { currentUser } from "../auth/sessions.js";
import { prisma } from "../db.js";
import { getWaitingRoom } from "../waiting-room.js";

export const waitingRoomRouter = Router();

// Both routes maintain expiry/promotion; only the explicit POST can create an entry.
waitingRoomRouter.route("/:showId{/:operation}").all(async (request, response, next) => {
  const join = request.method === "POST" && request.params.operation === "join";
  if (!join && !(request.method === "GET" && !request.params.operation)) { next(); return; }
  const user = await currentUser(request);
  if (!user) {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to join the waiting room." } });
    return;
  }
  const showId = request.params.showId;
  const show = await prisma.show.findUnique({ where: { id: showId }, select: { startsAt: true } });
  if (!show) {
    response.status(404).json({ error: { code: "SHOW_NOT_FOUND", message: "Show not found." } });
    return;
  }
  if (show.startsAt <= new Date()) {
    response.status(409).json({ error: { code: "SHOW_STARTED", message: "This show has already started." } });
    return;
  }
  const available = await prisma.showSeat.findFirst({
    where: { showId, booking: null }, select: { label: true },
  });
  if (!available) {
    response.status(409).json({ error: { code: "SHOW_SOLD_OUT", message: "No seats are available for this show." } });
    return;
  }
  const waitingRoom = await getWaitingRoom(user.id, showId, show.startsAt, join);
  response.status(200).json({ waitingRoom });
});
