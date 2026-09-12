CREATE TYPE "Currency" AS ENUM ('INR');

CREATE TABLE "Movie" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Movie_durationMinutes_positive" CHECK ("durationMinutes" > 0)
);

CREATE TABLE "Show" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "cinemaName" TEXT NOT NULL,
    "screenName" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "priceInPaise" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',

    CONSTRAINT "Show_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Show_priceInPaise_nonnegative" CHECK ("priceInPaise" >= 0)
);

CREATE INDEX "Show_movieId_startsAt_idx" ON "Show"("movieId", "startsAt");

ALTER TABLE "Show" ADD CONSTRAINT "Show_movieId_fkey"
FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
