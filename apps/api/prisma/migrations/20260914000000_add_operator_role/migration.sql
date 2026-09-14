CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'OPERATOR');

-- Existing and newly registered accounts receive no operator privileges.
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER';
CREATE INDEX "Show_startsAt_id_idx" ON "Show"("startsAt", "id");
