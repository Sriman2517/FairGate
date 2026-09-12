# FairGate

Movie booking with a virtual waiting room.

FairGate will admit customers to a cinema checkout at a controlled pace, while the booking service protects limited seat inventory. We are building it in small phases so that every part can be understood, explained, and modified.

## Current phase

**Phase 3: Next.js movie pages connected to the API.**

Customers can browse the three fictional movies and open a movie to see its synopsis, showtimes, and ticket prices. The website handles missing pages, movies without shows, and failed API requests. All listings are fixed demonstration data. Booking, accounts, persistent data, and the waiting room will arrive in later phases.

Start with the [Phase 3 learning guide](docs/phase-03-nextjs-pages.md). Earlier guides cover the [API foundation](docs/phase-01-api-foundation.md) and [movie catalogue](docs/phase-02-movie-catalogue.md).

## Run locally

Requirements: Node.js 22.12 or newer and npm. From the repository root, install the workspace dependencies once:

```sh
npm install
```

Use two terminals, both in the repository root:

```sh
# Terminal 1: Express API at http://127.0.0.1:4000
npm run dev:api
```

```sh
# Terminal 2: Next.js website at http://127.0.0.1:3000
npm run dev:web
```

Open `http://127.0.0.1:3000`. The API must be running to display listings. Click **View showtimes** on a movie to open its detail page. `after-the-rain` demonstrates a movie with no shows.

The web server uses `http://127.0.0.1:4000` by default. To use a different API address, copy `apps/web/.env.example` to `apps/web/.env.local`, edit `FAIRGATE_API_URL`, and restart the web server. This environment variable is read on the server and does not need a `NEXT_PUBLIC_` prefix.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:api` | Start the API and reload TypeScript changes. |
| `npm run dev:web` | Start the Next.js development server. |
| `npm run dev` | Existing shortcut for the API only. |
| `npm run typecheck` | Generate Next.js route types and type check both workspaces. |
| `npm run build` | Compile the API and build the website for production. |
| `npm run start:api` | Start the compiled API after building. |
| `npm run start:web` | Start the production website after building. |
| `npm start` | Existing shortcut for the compiled API only. |

Stop both development servers with `Ctrl+C` before running the production servers, which use the same ports. Use two terminals for production too. The build does not need a live API; the movie pages fetch when requested.

## API routes

All paths below use `http://127.0.0.1:4000` as the base URL.

| Method and path | Response |
| --- | --- |
| `GET /health` | `200` with API process status. |
| `GET /movies` | `200` with `{ "movies": [...] }`. |
| `GET /movies/:movieId` | `200` with `{ "movie": {...} }`, or `404` for a missing movie. |
| `GET /movies/:movieId/shows` | `200` with `{ "shows": [...] }`, or `404` for a missing movie. |

An existing movie without shows returns `200` with `{ "shows": [] }`. Missing movies return `{ "error": { "code": "MOVIE_NOT_FOUND", "message": "Movie not found." } }`.

The health response checks that the API process can answer a request. It does not check a database, queue, or payment provider.

## Repository layout

```text
apps/
  api/                      Express API (Phases 1 and 2)
  web/
    src/
      app/
        layout.tsx          Shared header, footer, and metadata
        page.tsx            Movie catalogue at /
        movies/[movieId]/
          page.tsx          One movie and its showtimes
        error.tsx           Failed-page message and retry button
        not-found.tsx       Missing-page message
        globals.css         Responsive styles
      lib/api.ts            Server-side HTTP calls and response types
    .env.example            Optional API address setting
    AGENTS.md               Next.js guidance for coding assistants
    CLAUDE.md               Reference to that guidance
    package.json            Web dependencies and commands
    tsconfig.json           Web compiler settings
docs/
  phase-01-api-foundation.md
  phase-02-movie-catalogue.md
  phase-03-nextjs-pages.md
AGENTS.md                   Agreement for phase-by-phase work
package.json                Root commands and npm workspaces
package-lock.json           Exact installed dependency versions
```

Next.js generates `next-env.d.ts` and `.next/` files when its commands run; they are ignored by Git. Both apps use the root lockfile.

On its first development run here, Next.js also generated `apps/web/AGENTS.md` and `CLAUDE.md`. These are coding-assistant instructions to consult the installed version's documentation, not application code. The root `AGENTS.md` still governs our learning phases and commit workflow.

## Learning workflow

For each phase, the assistant implements a small part, verifies it, and explains it. You review the code, ask questions, and make the commit yourself once it is clear. The next phase starts only after you say you are ready.

The development order is the API foundation, a small movie catalogue, the Next.js customer pages, persistent data and account ownership, safe seat booking, and then the waiting room and its tests. Each part can be split further if needed.
