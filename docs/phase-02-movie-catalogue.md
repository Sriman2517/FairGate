# Phase 2: movie and showtime API

## Outcome

FairGate can now return a movie catalogue, one movie's details, and that movie's showtimes. This is the data a future Next.js page will request before a customer enters the booking flow.

This phase adds two source files and connects them to the existing app. It uses the packages installed in Phase 1. All listings are fictional and read-only. No seat is held or booked by these endpoints.

## Read the code in this order

1. `apps/api/src/catalog.ts`: learn the data shape and inspect the fixtures.
2. `apps/api/src/routes/movies.ts`: follow each route from request to response.
3. `apps/api/src/app.ts`: see how the router becomes part of the app.

`server.ts` still starts the app on port 4000. The root README now lists the new endpoints; this guide explains their behavior.

## 1. Describe the data

`Movie` and `Show` are TypeScript interfaces. They describe the properties an object must have during type checking. For example, `durationMinutes` must be a number, and `currency` must be the string `"INR"`.

`Movie[]` means an array of movies. The `movies` array has three entries with stable string IDs. A show refers to its movie through `movieId`:

```text
movie.id:     the-last-signal
show.movieId: the-last-signal
```

One movie can have several shows. The third movie, `after-the-rain`, deliberately has none. These two resources are separate because a movie's title and synopsis stay the same across different screenings.

`startsAt` is a timestamp string, such as `2026-10-10T12:30:00Z`. The `Z` means UTC; that example is 6:00 PM in India. These dates are fixed demonstration data. The API does not filter by today's date, and a show in this list does not guarantee that seats are available.

`priceInPaise: 32000` means INR 320. Storing money in integer units avoids representing an amount such as 0.1 rupees as a binary floating-point fraction. A future UI can format it for display.

TypeScript interfaces disappear at runtime. They do not automatically check an incoming HTTP request, enforce unique IDs, validate timestamp strings, or ensure that a price is a nonnegative integer. For now, we control the fixture values; later phases will add validation where users can submit data.

The arrays are loaded into each API process's memory when the module is imported. They are not a database. Source changes are picked up when `tsx watch` restarts the development server, and there are no endpoints for saving changes.

## 2. Group related routes

`Router()` creates a group of Express routes. In `app.ts`, this line attaches that group:

```ts
app.use("/movies", moviesRouter);
```

The prefix and the route path combine:

| Prefix in app.ts | Path in movies.ts | Public URL path |
| --- | --- | --- |
| `/movies` | `/` | `/movies` |
| `/movies` | `/:movieId` | `/movies/the-last-signal` |
| `/movies` | `/:movieId/shows` | `/movies/the-last-signal/shows` |

The colon defines a URL parameter. For the last request above, Express gives the handler `request.params.movieId === "the-last-signal"`. Customers put the actual ID in the URL; they do not type the colon.

The imports use `.js` paths, just as in Phase 1. With our NodeNext configuration, TypeScript resolves the source modules while preserving paths that Node can use after compilation.

## 3. Follow one request

Consider `GET /movies/the-last-signal/shows`:

1. The HTTP server passes the request to `app`.
2. Express matches the `/movies` prefix and enters `moviesRouter`.
3. The `/:movieId/shows` handler reads the movie ID from the URL.
4. `movies.find(...)` searches for the movie. It returns one object, or `undefined` if nothing matches.
5. If the movie is missing, the handler sends a `404` JSON response and returns. The `return` prevents the rest of the handler from trying to send another response.
6. If the movie exists, `shows.filter(...)` collects every show with its ID. `filter` always returns an array, which can be empty.
7. The handler sends `200` with `{ "shows": [...] }`.

These fixtures are already in memory, so there is no asynchronous database operation to await. We can introduce that when data becomes persistent.

The list route uses `{ movies }`, JavaScript shorthand for `{ movies: movies }`. The shows route uses `{ shows: movieShows }` to keep the public response property named `shows` even though the local variable is called `movieShows`.

## 4. Understand success, empty results, and errors

| Request | Status | Body shape |
| --- | --- | --- |
| `/movies` | `200` | `{ "movies": [...] }` |
| `/movies/the-last-signal` | `200` | `{ "movie": {...} }` |
| `/movies/the-last-signal/shows` | `200` | `{ "shows": [...] }` containing two shows |
| `/movies/after-the-rain/shows` | `200` | `{ "shows": [] }` |
| `/movies/unknown-movie` | `404` | Missing-movie error below |
| `/movies/unknown-movie/shows` | `404` | Same missing-movie error |

Both missing-movie routes return:

```json
{
  "error": {
    "code": "MOVIE_NOT_FOUND",
    "message": "Movie not found."
  }
}
```

The code gives future frontend logic a stable value to check. The message explains what happened.

An existing movie with no shows is a successful lookup of an empty collection. A movie ID that does not exist is a missing resource. If we only filtered the shows array without checking the movie, both cases would incorrectly look identical.

Other unknown URL paths still use Express's default 404 response. This phase only defines the JSON error contract for missing movies in these two routes.

## Try it locally

From the repository root:

```sh
npm run dev
```

Open `http://127.0.0.1:4000/movies` in your browser. Then try the detail and shows paths from the table above. You can also use a second PowerShell terminal to see response headers and status codes:

```powershell
curl.exe -i http://127.0.0.1:4000/movies/the-last-signal/shows
curl.exe -i http://127.0.0.1:4000/movies/after-the-rain/shows
curl.exe -i http://127.0.0.1:4000/movies/unknown-movie/shows
```

Check your changes with:

```sh
npm run typecheck
npm run build
```

To try the compiled version, stop the development server with `Ctrl+C`, then run `npm start` and repeat a request. A type check verifies TypeScript; an HTTP request verifies observable route behavior. They answer different questions.

## Small exercise

If you tried the compiled version, stop it with `Ctrl+C` and restart `npm run dev` so your source changes reload automatically.

Before making a change, predict which responses will change if you add a show for `after-the-rain`.

Add one object to the `shows` array with a new show ID and `movieId: "after-the-rain"`. Fill in the remaining fields using the `Show` interface. Use a UTC timestamp and an integer price in paise.

Then verify:

- `/movies/after-the-rain/shows` returns one show.
- `/movies/the-last-signal/shows` still returns its original two shows.
- `/movies/unknown-movie/shows` still returns `404`.
- Type checking and the build still pass.

## Learning checkpoint

Before committing, be able to explain:

- How the router prefix and URL parameter select a handler.
- Why the code uses `find` for a movie and `filter` for its shows.
- Why an existing movie can return an empty shows array with status `200`.
- Why the early `return` matters after sending an error response.
- What TypeScript checks, and what still needs runtime validation.
- Why these arrays cannot provide shared, durable booking inventory.

Review the diff and make the commit yourself once the code is clear. We will start the next phase after you say you are ready.
