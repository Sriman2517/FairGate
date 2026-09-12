import express from "express";
import { moviesRouter } from "./routes/movies.js";

export const app = express();

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "fairgate-api",
  });
});

app.use("/movies", moviesRouter);
