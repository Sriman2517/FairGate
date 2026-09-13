import { prisma } from "../src/db.js";
import { movies, shows } from "./seed-data.js";

async function seed() {
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
  });
}

try {
  await seed();
  console.log("Demo catalogue and seat inventory seeded. Existing rows and bookings were preserved.");
} catch {
  console.error("Seeding failed. Check DATABASE_URL, database health, and applied migrations.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
