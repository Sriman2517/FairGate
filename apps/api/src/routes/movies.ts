import { Router } from "express";
import { prisma } from "../db.js";

export const moviesRouter = Router();

moviesRouter.get("/", async (_request, response) => {
  const movies = await prisma.movie.findMany({
    orderBy: [{ featured: "desc" }, { title: "asc" }, { id: "asc" }],
  });
  response.status(200).json({ movies });
});

moviesRouter.get("/:movieId", async (request, response) => {
  const movie = await prisma.movie.findUnique({
    where: { id: request.params.movieId },
  });

  if (!movie) {
    response.status(404).json({
      error: { code: "MOVIE_NOT_FOUND", message: "Movie not found." },
    });
    return;
  }

  response.status(200).json({ movie });
});

moviesRouter.get("/:movieId/shows", async (request, response) => {
  const movie = await prisma.movie.findUnique({
    where: { id: request.params.movieId },
    select: {
      shows: { orderBy: [{ startsAt: "asc" }, { id: "asc" }] },
    },
  });

  if (!movie) {
    response.status(404).json({
      error: { code: "MOVIE_NOT_FOUND", message: "Movie not found." },
    });
    return;
  }

  response.status(200).json({ shows: movie.shows });
});
