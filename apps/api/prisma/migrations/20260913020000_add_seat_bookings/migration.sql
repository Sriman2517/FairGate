CREATE TABLE "ShowSeat" (
    "showId" TEXT NOT NULL,
    "label" VARCHAR(12) NOT NULL,
    "row" CHAR(1) NOT NULL,
    "number" INTEGER NOT NULL,
    CONSTRAINT "ShowSeat_pkey" PRIMARY KEY ("showId", "label"),
    CONSTRAINT "ShowSeat_row_check" CHECK ("row" ~ '^[A-Z]$'),
    CONSTRAINT "ShowSeat_number_check" CHECK ("number" BETWEEN 1 AND 99),
    CONSTRAINT "ShowSeat_label_check" CHECK ("label" = "row" || "number"::text)
);

CREATE UNIQUE INDEX "ShowSeat_showId_row_number_key" ON "ShowSeat"("showId", "row", "number");
ALTER TABLE "ShowSeat" ADD CONSTRAINT "ShowSeat_showId_fkey"
FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "showId" TEXT NOT NULL,
    "seatLabel" VARCHAR(12) NOT NULL,
    "requestId" UUID NOT NULL,
    "priceInPaise" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Booking_priceInPaise_check" CHECK ("priceInPaise" >= 0)
);

CREATE UNIQUE INDEX "Booking_showId_seatLabel_key" ON "Booking"("showId", "seatLabel");
CREATE UNIQUE INDEX "Booking_userId_requestId_key" ON "Booking"("userId", "requestId");
CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking"("userId", "createdAt");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_showId_seatLabel_fkey"
FOREIGN KEY ("showId", "seatLabel") REFERENCES "ShowSeat"("showId", "label") ON DELETE RESTRICT ON UPDATE CASCADE;
