BEGIN;
ALTER TABLE "Movie" ADD COLUMN "posterPath" TEXT, ADD COLUMN "genre" TEXT, ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "turnId" TEXT;
CREATE UNIQUE INDEX "Booking_turnId_key" ON "Booking"("turnId");
CREATE UNIQUE INDEX "Booking_id_showId_key" ON "Booking"("id", "showId");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "BookingSeat" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "showId" TEXT NOT NULL,
  "seatLabel" VARCHAR(12) NOT NULL,
  "priceInPaise" INTEGER NOT NULL CHECK ("priceInPaise" >= 0),
  CONSTRAINT "BookingSeat_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingSeat_bookingId_showId_fkey" FOREIGN KEY ("bookingId", "showId") REFERENCES "Booking"("id", "showId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BookingSeat_showId_seatLabel_fkey" FOREIGN KEY ("showId", "seatLabel") REFERENCES "ShowSeat"("showId", "label") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BookingSeat_showId_seatLabel_key" ON "BookingSeat"("showId", "seatLabel");
CREATE INDEX "BookingSeat_bookingId_showId_idx" ON "BookingSeat"("bookingId", "showId");
-- Preserve the original reference, customer, request key, price, and seat.
INSERT INTO "BookingSeat" ("id", "bookingId", "showId", "seatLabel", "priceInPaise")
SELECT "id", "id", "showId", "seatLabel", "priceInPaise" FROM "Booking";
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_showId_seatLabel_fkey";
DROP INDEX "Booking_showId_seatLabel_key";
ALTER TABLE "Booking" DROP COLUMN "seatLabel";
CREATE TABLE "BookingRelease" (
  "bookingId" UUID PRIMARY KEY,
  "userId" UUID NOT NULL,
  "showId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingRelease_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE
);
CREATE INDEX "BookingRelease_nextAttemptAt_idx" ON "BookingRelease"("nextAttemptAt");
COMMIT;
