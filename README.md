# FairGate

Movie booking with a virtual waiting room.

FairGate will admit customers to a cinema checkout at a controlled pace, while the booking service protects limited seat inventory. We are building it in small phases so that every part can be understood, explained, and modified.

## Current phase

**Phase 4: a persistent movie catalogue with PostgreSQL and Prisma.**

The existing API and Next.js pages now read movie and showtime records from PostgreSQL. Migrations define the database structure, and a repeatable seed command adds fictional demo data. Database edits survive API and database restarts. Accounts, reservations, and the waiting room will arrive in later phases.

Start with the [Phase 4 learning guide](docs/phase-04-postgresql-catalogue.md). Earlier guides describe the [API foundation](docs/phase-01-api-foundation.md), [in-memory catalogue](docs/phase-02-movie-catalogue.md), and [Next.js pages](docs/phase-03-nextjs-pages.md). Those guides document their original phases; use the current setup below.

## First-time setup

Requirements: Node.js 22.12 or newer, npm, and Docker Desktop running Linux containers. Run these commands from the repository root:

```sh
npm install
```

Create the API environment file once. In PowerShell:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Keep an existing `.env` if you have already configured it. The example matches the local database in `compose.yaml`: database `fairgate`, user `fairgate`, password `fairgate_dev`, and host port `5433`. These are development credentials; the port is bound to this computer's loopback interface.

```sh
npm run db:start
npm run db:generate
npm run db:deploy
npm run db:seed
```

`db:deploy` applies the checked-in migrations. `db:seed` inserts missing demo rows without changing existing ones. Neither command is a database reset.

## Everyday development

Start Docker Desktop and run `npm run db:start` if the database is stopped. Then use two terminals in the repository root:

```sh
# Terminal 1: API at http://127.0.0.1:4000
npm run dev:api
```

```sh
# Terminal 2: website at http://127.0.0.1:3000
npm run dev:web
```

Open `http://127.0.0.1:3000`. Both the API and database must be available to display listings. The movies are sorted by title, and each movie's shows are sorted by start time.

Run `npm run db:studio` to inspect and edit local records in Prisma Studio. Reload the webpage after editing data. Fixture edits in `prisma/seed-data.ts` no longer change the running catalogue automatically.

The web server uses API address `http://127.0.0.1:4000` by default. To change it, copy `apps/web/.env.example` to `apps/web/.env.local`, edit `FAIRGATE_API_URL`, and restart the web server.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:api` / `npm run dev:web` | Run the API / website in development. |
| `npm run dev` | Existing shortcut for the API only. |
| `npm run typecheck` | Generate required types and check both workspaces. |
| `npm run build` | Generate Prisma Client, compile the API, and build the website. |
| `npm run start:api` / `npm run start:web` | Run the compiled apps, each in its own terminal. |
| `npm start` | Existing shortcut for the compiled API only. |
| `npm run db:start` | Start PostgreSQL and wait for its health check. |
| `npm run db:stop` | Stop PostgreSQL while retaining its data. |
| `npm run db:generate` | Generate the typed Prisma Client from the schema. |
| `npm run db:deploy` | Apply migrations already present in Git. |
| `npm run db:migrate -- --name change_name` | Create and apply a migration after changing the schema locally. |
| `npm run db:seed` | Insert missing demo movies and shows. |
| `npm run db:studio` | Open a database editor for the local catalogue. |

Stop development servers with `Ctrl+C` before starting production servers on the same ports. Generation and building need the API environment file but do not need a running database. Reading or editing records does.

PostgreSQL stores its files in the `fairgate_postgres_data` Docker volume. Stopping the container retains the data. Removing that volume deletes the database; it is not part of the normal workflow.

## API routes

The base URL is `http://127.0.0.1:4000`.

| Method and path | Response |
| --- | --- |
| `GET /health` | `200` when the API process can answer; does not query the database. |
| `GET /movies` | `200` with `{ "movies": [...] }`. |
| `GET /movies/:movieId` | `200` with `{ "movie": {...} }`, or `404` for a missing movie. |
| `GET /movies/:movieId/shows` | `200` with `{ "shows": [...] }`, or `404` for a missing movie. |

An existing movie without shows returns `200` with `{ "shows": [] }`. Missing movies still use error code `MOVIE_NOT_FOUND`. Failed database queries return `500` with code `INTERNAL_SERVER_ERROR` and a generic message. A running API with an unavailable database can therefore have a healthy `/health` response while catalogue requests fail.

## Repository layout

```text
compose.yaml                Local PostgreSQL service and persistent volume
apps/
  api/
    .env.example            Local database connection settings
    prisma.config.ts        Prisma CLI paths, environment, and seed command
    tsconfig.check.json     Type checking for API source, seeds, and CLI config
    prisma/
      schema.prisma         Movie and Show models
      migrations/           Checked-in SQL history
      seed-data.ts          Demo data moved from src/catalog.ts
      seed.ts               Repeatable demo inserts
    src/
      db.ts                 Shared Prisma client and PostgreSQL adapter
      app.ts                Route registration and error handling
      routes/movies.ts      Database-backed catalogue queries
      server.ts             Server startup
      generated/            Prisma output (ignored by Git)
  web/                      Next.js movie pages from Phase 3
docs/                       One learning guide per phase
AGENTS.md                   Phase and commit agreement
package.json                Root commands and npm workspaces
package-lock.json           Exact installed dependency versions
```

Prisma's generated client, Next.js output, compiled API files, and local `.env` files are ignored. Commit the schema, migrations, seed scripts, package changes, and guides. Next.js's existing `apps/web/AGENTS.md` and `CLAUDE.md` point coding assistants to its installed documentation; the root learning agreement still applies.

## Learning workflow

For each phase, the assistant implements a small part, verifies it, and explains it. You review the code, ask questions, and make the commit yourself once it is clear. The next phase starts only after you say you are ready.

The development order is the API foundation, a small movie catalogue, the Next.js customer pages, persistent data and account ownership, safe seat booking, and then the waiting room and its tests. Each part can be split further if needed.
