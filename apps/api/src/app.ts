import express, { type ErrorRequestHandler } from "express";
import { moviesRouter } from "./routes/movies.js";

export const app = express();

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "fairgate-api",
  });
});

app.use("/movies", moviesRouter);

// Express 5 forwards rejected async route handlers to this middleware.
const handleError: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  console.error("An API request failed.", error instanceof Error ? error.name : "UnknownError");
  response.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong. Please try again." },
  });
};

app.use(handleError);
