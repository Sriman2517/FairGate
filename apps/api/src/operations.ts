import { prisma } from "./db.js";
import { runRedis, WaitingRoomUnavailable } from "./redis.js";
import { waitingRoomKeys, waitingRoomRules } from "./waiting-room.js";

export const operationsShowLimit = 50;

// One read-only script gives all counts the same Redis clock. It never prunes,
// renews a heartbeat, or promotes a waiter. Live leases correspond to FIFO members.
const readRooms = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local result = {now}
for i = 1, #KEYS, 2 do
  table.insert(result, redis.call('ZCOUNT', KEYS[i], '(' .. now, '+inf'))
  table.insert(result, redis.call('ZCOUNT', KEYS[i + 1], '(' .. now, '+inf'))
end
return result
`;

export async function getOperationsSnapshot() {
  const inventoryObservedAt = new Date();
  // Keep seat totals and bookings consistent even if a customer books between queries.
  // Redis is read AFTER this short transaction, so an outage cannot hold it open.
  const inventory = await prisma.$transaction(async (tx) => {
    const upcoming = await tx.show.findMany({
      where: { startsAt: { gt: inventoryObservedAt } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: operationsShowLimit + 1,
      select: { id: true, cinemaName: true, screenName: true, startsAt: true,
        movie: { select: { title: true } }, _count: { select: { seats: true } } },
    });
    const shows = upcoming.slice(0, operationsShowLimit);
    const bookings = await tx.bookingSeat.groupBy({ by: ["showId"],
      where: { showId: { in: shows.map((show) => show.id) } }, _count: { _all: true } });
    const bookedByShow = new Map(bookings.map((booking) => [booking.showId, booking._count._all]));
    return { hasMore: upcoming.length > operationsShowLimit, shows: shows.map((show) => {
      const bookedSeats = bookedByShow.get(show.id) ?? 0;
      return { id: show.id, movieTitle: show.movie.title, cinemaName: show.cinemaName,
        screenName: show.screenName, startsAt: show.startsAt.toISOString(),
        totalSeats: show._count.seats, bookedSeats, availableSeats: show._count.seats - bookedSeats };
    }) };
  }, { isolationLevel: "RepeatableRead" });

  let queue: { observedAt: string; counts: number[] } | null = null;
  try {
    const result = await runRedis((connection) => connection.evalRo(readRooms, {
      keys: inventory.shows.flatMap((show) => {
        const [, active, leases] = waitingRoomKeys(show.id);
        return [leases, active];
      }), arguments: [],
    })) as number[];
    queue = { observedAt: new Date(result[0]).toISOString(), counts: result.slice(1) };
  } catch (error) {
    if (!(error instanceof WaitingRoomUnavailable)) throw error;
  }
  return {
    inventoryObservedAt: inventoryObservedAt.toISOString(), queueObservedAt: queue?.observedAt ?? null,
    queueStatus: queue ? "available" as const : "unavailable" as const,
    limit: operationsShowLimit, hasMore: inventory.hasMore,
    shows: inventory.shows.map((show, i) => ({ ...show,
      waitingCustomers: queue ? queue.counts[i * 2] : null,
      activeTurns: queue ? queue.counts[i * 2 + 1] : null,
      checkoutCapacity: waitingRoomRules.capacity,
    })),
  };
}
