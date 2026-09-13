// Each fork imports its own app, connection pool, and process-local state.
import { app } from "../../src/app.js";
import { prisma } from "../../src/db.js";

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") process.send?.({ port: address.port });
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on("message", (message) => { if (message === "shutdown") void stop().catch(() => process.exit(1)); });
process.once("disconnect", () => { void stop().catch(() => process.exit(1)); });
