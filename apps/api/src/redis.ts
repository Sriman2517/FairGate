import "dotenv/config";
import { createClient } from "redis";

function makeConnection() {
  return createClient({
    url: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
    socket: { connectTimeout: 1500, reconnectStrategy: false },
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
  });
}

type Redis = ReturnType<typeof makeConnection>;
let client: Redis | undefined;
let connecting: Promise<Redis> | undefined;

export class WaitingRoomUnavailable extends Error {
  constructor() { super("The waiting room is temporarily unavailable."); }
}

// A TCP connection can succeed while Redis never answers its handshake/command.
// Bound the whole operation and close that connection on timeout.
async function deadline<T>(operation: Promise<T>, connection: Redis): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          if (connection.isOpen) connection.destroy();
          reject(new WaitingRoomUnavailable());
        }, 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getRedis(): Promise<Redis> {
  if (client?.isReady) return client;
  if (connecting) return connecting;
  const next = makeConnection();
  // The listener is required. Request handlers return a sanitized 503 on failure.
  next.on("error", () => {});
  client = next;
  connecting = deadline(next.connect(), next).then(() => next).catch((error) => {
    if (next.isOpen) next.destroy();
    throw error;
  }).finally(() => { connecting = undefined; });
  return connecting;
}

export async function runRedis<T>(operation: (connection: Redis) => Promise<T>): Promise<T> {
  try {
    const connection = await getRedis();
    return await deadline(operation(connection), connection);
  } catch {
    // Never fall back to a process-local queue or grant access during an outage.
    throw new WaitingRoomUnavailable();
  }
}

export async function closeRedis() {
  if (client?.isOpen) client.destroy();
}
