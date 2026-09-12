import { Router } from "express";
import { movies, shows } from "../catalog.js";

export const moviesRouter = Router();

moviesRouter.get("/", (_request, response) => {
  response.status(200).json({ movies });
});

moviesRouter.get("/:movieId", (request, response) => {
  const movie = movies.find((movie) => movie.id === request.params.movieId);

  if (!movie) {
    response.status(404).json({
      error: { code: "MOVIE_NOT_FOUND", message: "Movie not found." },
    });
    return;
  }

  response.status(200).json({ movie });
});

moviesRouter.get("/:movieId/shows", (request, response) => {
  const movie = movies.find((movie) => movie.id === request.params.movieId);

  if (!movie) {
    response.status(404).json({
      error: { code: "MOVIE_NOT_FOUND", message: "Movie not found." },
    });
    return;
  }

  const movieShows = shows.filter((show) => show.movieId === movie.id);
  response.status(200).json({ shows: movieShows });
});
