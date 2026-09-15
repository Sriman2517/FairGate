import { prisma } from "./db.js";
import { finishWaitingRoomTurn } from "./waiting-room.js";

// The durable row is committed WITH the ticket. Failure here never undoes a booking.
export async function releaseBookingTurn(bookingId: string, finish = finishWaitingRoomTurn): Promise<boolean> {
  try {
    const job = await prisma.bookingRelease.findUnique({ where: { bookingId } });
    if (!job) return true;
    const available = await prisma.showSeat.findFirst({ where: { showId: job.showId, booking: null }, select: { label: true } });
    await finish(job.userId, job.showId, job.startsAt, available !== null, job.turnId);
    await prisma.bookingRelease.deleteMany({ where: { bookingId } });
    return true;
  } catch {
    await prisma.bookingRelease.updateMany({ where: { bookingId }, data: {
      attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5000),
    } }).catch(() => undefined);
    return false;
  }
}

export function startReleaseWorker() {
  let stopped = false;
  let running: Promise<void> | undefined;
  async function batch() {
    try {
      const jobs = await prisma.bookingRelease.findMany({ where: { nextAttemptAt: { lte: new Date() } },
        orderBy: [{ nextAttemptAt: "asc" }, { bookingId: "asc" }], take: 20, select: { bookingId: true } });
      for (const job of jobs) {
        if (stopped) break;
        await releaseBookingTurn(job.bookingId);
      }
    } catch { /* Dependencies may be down. Durable jobs remain for the next batch. */ }
  }
  function tick() {
    if (!stopped && !running) running = batch().finally(() => { running = undefined; });
  }
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
