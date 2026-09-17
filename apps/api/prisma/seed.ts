import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { movies, shows } from "./seed-data.js";

// Administration may wait for a hosted database to wake up. Keep these deadlines
// separate from the API's short request limits, and use the migration connection.
const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaPg({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 15000,
  statement_timeout: 15000,
  query_timeout: 20000,
}) });

async function seed() {
  if (!connectionString) throw new Error("Set DIRECT_DATABASE_URL or DATABASE_URL before seeding.");
  // Establish and verify the connection before starting the transaction clock.
  await prisma.$queryRaw`SELECT 1`;
  await prisma.$transaction(async (transaction) => {
    for (const movie of movies) {
      await transaction.movie.upsert({
        where: { id: movie.id },
        create: movie,
        update: {},
      });
    }

    for (const show of shows) {
      await transaction.show.upsert({
        where: { id: show.id },
        create: { ...show, startsAt: new Date(show.startsAt) },
        update: {},
      });

      // Inventory belongs to each show. Rerunning the seed preserves booked seats.
      const seats = ["A", "B", "C", "D"].flatMap((row) =>
        Array.from({ length: 8 }, (_unused, index) => ({
          showId: show.id, label: `${row}${index + 1}`, row, number: index + 1,
        })),
      );
      await transaction.showSeat.createMany({ data: seats, skipDuplicates: true });
    }
  }, { maxWait: 20000, timeout: 60000 });
}

try {
  await seed();
  console.log("Demo catalogue and seat inventory seeded. Existing rows and bookings were preserved.");
} catch (error) {
  console.error("Seeding failed. Check DIRECT_DATABASE_URL (or DATABASE_URL), database health, and applied migrations.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
