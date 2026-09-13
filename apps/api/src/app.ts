import express, { type ErrorRequestHandler } from "express";
import { moviesRouter } from "./routes/movies.js";
import { authRouter } from "./routes/auth.js";
import { showsRouter } from "./routes/shows.js";
import { bookingsRouter } from "./routes/bookings.js";

export const app = express();

app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok", service: "fairgate-api" });
});

app.use("/movies", moviesRouter);
// Availability and customer-specific data must be fetched fresh, including errors.
app.use(["/auth", "/shows", "/bookings"], (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});
app.use("/auth", express.json({ limit: "4kb", strict: false }), authRouter);
app.use("/shows", showsRouter);
app.use("/bookings", express.json({ limit: "4kb", strict: false }), bookingsRouter);

const handleError: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error?.type === "entity.parse.failed") {
    response.status(400).json({ error: { code: "INVALID_JSON", message: "Send a valid JSON body." } });
    return;
  }
  if (error?.type === "entity.too.large") {
    response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." } });
    return;
  }
  console.error("An API request failed.", error instanceof Error ? error.name : "UnknownError");
  response.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong. Please try again." },
  });
};

app.use(handleError);
