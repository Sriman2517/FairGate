import { startReleaseWorker } from "./booking-release.js";
import { app } from "./app.js";
import { readApiConfig } from "./config.js";
import { prisma } from "./db.js";
import { closeRedis } from "./redis.js";
import { createShutdown, lifecycle } from "./lifecycle.js";

const { host, port } = readApiConfig();

const server = app.listen(port, host, () => {
  console.info(JSON.stringify({ event: "server_listening", host, port }));
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.setTimeout(30_000, (socket) => socket.destroy());
const stopReleases = startReleaseWorker();
const shutdown = createShutdown(server, [async () => { await stopReleases(); await Promise.all([prisma.$disconnect(), closeRedis()]); }], () => { lifecycle.draining = true; });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown().then((clean) => {
      console.info(JSON.stringify({ event: "server_stopped", clean }));
      process.exit(clean ? 0 : 1);
    });
  });
}
server.on("error", () => {
  console.error("The API listener failed. Check HOST, PORT, and whether the port is already occupied.");
  void shutdown().then(() => process.exit(1));
});
