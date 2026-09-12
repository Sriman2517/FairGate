# Phase 4: PostgreSQL catalogue

## Outcome

Movie and show records now live in PostgreSQL. Express uses Prisma to query them, and the existing Next.js pages continue consuming the same API response shapes.

Restarting Node no longer reloads the catalogue from an array. Restarting PostgreSQL retains the records in its Docker volume. This phase establishes persistent data and database constraints; it does not implement accounts, seat holds, reservations, or queue admission.

## Read the code in this order

1. `apps/api/prisma/schema.prisma`: the two models and their relationship.
2. `apps/api/prisma/migrations/20260913000000_create_catalogue/migration.sql`: SQL that creates them.
3. `apps/api/src/db.ts`: one Prisma client shared by the API.
4. `apps/api/src/routes/movies.ts`: asynchronous database queries replacing array operations.
5. `apps/api/prisma/seed.ts` and `seed-data.ts`: initial demo records.
6. `compose.yaml`, `prisma.config.ts`, and the package scripts: how everything starts.

The only other API behavior change is the final error middleware in `app.ts`. Frontend source files are unchanged.

## 1. Understand the model

`Movie` maps to a database table. Its `id` is the primary key: PostgreSQL requires it to be unique and non-null. The title, language, synopsis, and running time remain the fields introduced in Phase 2.

`Show` maps to another table. Its `movieId` column references `Movie.id` through a foreign key. PostgreSQL rejects a show whose movie does not exist. The `onDelete: Restrict` rule also prevents deleting a movie while it still has shows.

```text
Movie                       Show
id (primary key) <--------- movieId (foreign key)
title                       id (primary key)
synopsis                    startsAt
language                    priceInPaise
durationMinutes             cinemaName, screenName, currency
```

`Movie.shows` and `Show.movie` are Prisma relation fields. They describe navigation between related records; they do not become extra columns. `movieId` is the actual stored foreign-key column.

The `Currency` enum currently allows only `INR`. `startsAt` is a PostgreSQL timestamp with timezone and millisecond precision. PostgreSQL stores an instant rather than the original timezone label; our UI still formats the time in India. Prisma returns a JavaScript `Date`, which Express's JSON serialization turns into an ISO timestamp. You may now see `.000Z` instead of `Z`, representing the same instant.

The SQL migration additionally requires positive `durationMinutes` and nonnegative `priceInPaise`. These `CHECK` constraints are written in SQL because the Prisma schema does not express them here. Read the migration as well as the schema to see the complete database rules.

The composite index on `(movieId, startsAt)` supports finding a movie's shows in time order. An index is a stored lookup structure with storage and write costs; we add this one because it matches a query this API actually performs.

## 2. Separate schema, migration, client, and seed

| Piece | Responsibility |
| --- | --- |
| `schema.prisma` | Describes models and relationships for Prisma. |
| `migration.sql` | Changes the actual database structure. |
| Generated Prisma Client | Provides typed operations such as `movie.findUnique`. |
| `seed.ts` | Inserts initial records into the existing tables. |

Changing the schema file alone does not change PostgreSQL. Generating a client alone does not create tables. Seeding assumes the tables already exist.

Prisma 7 uses `prisma.config.ts` for the connection URL and command paths. `dotenv/config` loads the API workspace's `.env`. Our npm workspace scripts run with `apps/api` as their working directory, making that location consistent.

The Prisma CLI, runtime, and PostgreSQL adapter are pinned to the same Prisma 7 version. The new generator writes TypeScript into `src/generated/prisma`. Its internal `.ts` imports work under `tsx`; `rewriteRelativeImportExtensions` in `tsconfig.json` rewrites them to `.js` when compiling. Handwritten API imports keep the `.js` convention from Phase 1.

Generated files are ignored by Git and recreated with `db:generate`. Type checking and building also generate them, so those commands work on a fresh checkout after dependencies and `.env` are set up.

`tsconfig.check.json` extends the API compiler settings to check source files, seed scripts, and Prisma configuration without producing output. The production build still uses `tsconfig.json` to compile only the API source. Running a script through `tsx` alone does not type check it.

## 3. Trace a database-backed request

```text
Browser -> Next.js -> GET /movies/the-last-signal/shows
  -> Express handler awaits prisma.movie.findUnique(...)
  -> Prisma uses the PostgreSQL adapter and connection pool
  -> PostgreSQL returns the movie's shows
  -> Express returns { "shows": [...] }
  -> Next.js renders the existing page
```

`findMany` replaces the list's direct array access. `findUnique` replaces `movies.find(...)` because an ID is unique. The shows handler selects the `shows` relation on a movie lookup.

That lookup returns `null` when the movie is missing, or an object containing an empty `shows` array when the movie exists without screenings. It preserves the distinction you learned in Phase 2: missing movie means `404`; empty shows means a successful `200`.

The handlers are now `async` because database operations return Promises. `await` lets Node serve other work while it waits for the database. There is one shared Prisma client per process, rather than a new client and pool for every request.

Unlike an array, a SQL table has no promised default row order. We explicitly sort movies by title, then ID, and shows by start time, then ID. The second field resolves ties consistently.

## 4. Handle failed database requests

Express 5 forwards rejected async handlers to the final error middleware in `app.ts`. It returns `500` and a generic JSON error. It does not turn database failures into an empty list or a missing-movie response.

The PostgreSQL adapter has a three-second connection timeout. This limits waiting to establish or acquire a connection; it is not a general execution limit for every SQL query. The Next.js server also retains its own fetch timeout from Phase 3.

`/health` still checks only the API process. During a database outage, `/health` can return `200` while `/movies` returns `500`. They answer different questions. A database-aware readiness endpoint can be added when deployment needs it.

## 5. Run the local database

Docker Desktop must be running Linux containers. From the repository root:

```sh
npm install
```

If you do not already have `apps/api/.env`, create it in PowerShell:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Then run:

```sh
npm run db:start
npm run db:generate
npm run db:deploy
npm run db:seed
```

`db:start` starts only PostgreSQL. Port `5433` on your computer maps to PostgreSQL's port `5432` inside the container. The binding uses `127.0.0.1`, so this development service is available locally. The database files live in the named volume `fairgate_postgres_data`.

`db:deploy` applies the checked-in migration and records it in PostgreSQL's `_prisma_migrations` table. Running it again applies only pending migrations. It does not generate new migration files or reset the database.

When you intentionally change the schema in a future phase, `npm run db:migrate -- --name change_name` creates and applies a development migration. That command uses a temporary shadow database to compare migration history. A reset prompt is not a normal setup step; stop and understand the mismatch before accepting one. Do not edit migration files that have already been applied.

`db:stop` stops the service and keeps its records. Removing its Docker volume deletes the database. Our normal start/stop commands retain it.

After setup, start the API and website in separate terminals with `npm run dev:api` and `npm run dev:web`. Open `http://127.0.0.1:3000`. To inspect the database, run `npm run db:studio` in another terminal and use the local URL it prints.

## 6. Understand repeatable seeding

The old `src/catalog.ts` has moved to `prisma/seed-data.ts`. It supplies initial records; route handlers no longer import it.

The seed script creates movies before their shows because the foreign key requires a movie to exist first. Each `upsert` means: create this row if its ID is missing; otherwise perform the specified update. Our `update: {}` deliberately makes no changes to existing records.

The inserts share a transaction. Either all required inserts succeed or the transaction rolls back. The script disconnects its Prisma client when finished so the command can exit.

You can run seeding twice without duplicating rows. You can also edit a title in Prisma Studio and rerun seeding without losing that edit. Changing an existing fixture's title in `seed-data.ts` will therefore **not** update its database row. Use Studio to edit records, or introduce a deliberate data migration when a future change requires one.

The earlier phases' array-editing exercise is now historical. Editing records in PostgreSQL and reloading the page is the current workflow.

## Verification and exercise

First check the code:

```sh
npm run typecheck
npm run build
```

Then open the website and verify movie details, showtimes, the empty-show message for After the Rain, and the missing-page message for an unknown movie ID.

For the exercise:

1. Open Prisma Studio with `npm run db:studio`.
2. Change one show's `priceInPaise` to `32500`, save the record, and predict the displayed INR price.
3. Reload its webpage. It should display `₹325.00`.
4. Stop and restart the API. Reload the page and confirm the price remains.
5. Run `npm run db:stop` followed by `npm run db:start`. Reload and confirm it still remains.
6. Run `npm run db:seed` again. Confirm your edited price is preserved.

You can restore the original price in Studio after finishing. If you try an invalid negative price, the database should reject it even though the edit did not go through an Express endpoint.

## Learning checkpoint

Before committing, explain:

- Why a Docker volume survives a container stop while a Node array does not survive a process restart.
- How primary keys, foreign keys, and checks protect the stored data.
- Why schema changes, client generation, and seeding are separate operations.
- How the same frontend now displays persistent records without source changes.
- Why seeding twice preserves an edited row.
- Why database persistence alone does not solve concurrent seat booking.

Review the source, SQL migration, and lockfile changes, then make the commit yourself once they are clear. We stop here until you are ready for the next phase.

## Official references

- [Prisma Client generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [Prisma configuration](https://docs.prisma.io/docs/orm/reference/prisma-config-reference)
- [Applying checked-in migrations](https://docs.prisma.io/docs/cli/migrate/deploy)
- [Development migrations and shadow databases](https://docs.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database)
- [PostgreSQL Docker image](https://hub.docker.com/_/postgres)
