import { Router } from "express";
import { prisma } from "../db.js";

export const showsRouter = Router();

showsRouter.get("/:showId", async (request, response) => {
  const show = await prisma.show.findUnique({
    where: { id: request.params.showId },
    select: {
      id: true, movieId: true, movie: { select: { title: true } },
      cinemaName: true, screenName: true, startsAt: true, priceInPaise: true, currency: true,
      seats: {
        orderBy: [{ row: "asc" }, { number: "asc" }],
        select: { label: true, row: true, number: true, booking: { select: { id: true } } },
      },
    },
  });
  if (!show) {
    response.status(404).json({ error: { code: "SHOW_NOT_FOUND", message: "Show not found." } });
    return;
  }

  response.status(200).json({
    show: {
      id: show.id, movieId: show.movieId, movieTitle: show.movie.title,
      cinemaName: show.cinemaName, screenName: show.screenName, startsAt: show.startsAt,
      priceInPaise: show.priceInPaise, currency: show.currency,
    },
    seats: show.seats.map((seat) => ({
      label: seat.label, row: seat.row, number: seat.number, available: seat.booking === null,
    })),
  });
});
