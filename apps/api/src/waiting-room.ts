import { createHash, randomUUID } from "node:crypto";
import { runRedis } from "./redis.js";

// All API processes must run the same rules. These are deliberately small demo limits.
export const waitingRoomRules = {
  capacity: 2,
  checkoutMs: 120_000,
  heartbeatMs: 60_000,
  maxWaiting: 1000,
  pollAfterMs: 5000,
} as const;

export interface WaitingRoomState {
  status: "not_joined" | "waiting" | "admitted";
  position: number | null;
  expiresAt: string | null;
  serverTime: string;
  pollAfterMs: number;
  turnId: string | null;
}

export class WaitingRoomFull extends Error {}
export class WaitingRoomClosed extends Error {}

export function waitingRoomKeys(showId: string) {
  const showHash = createHash("sha256").update(showId).digest("hex");
  const prefix = `fairgate:waiting-room:{${showHash}}`;
  return ["waiting", "active", "leases", "sequence", "turns"].map((suffix) => `${prefix}:${suffix}`);
}

// Redis executes this entire script without interleaving another caller's commands.
// KEYS: FIFO order, checkout deadlines, waiting heartbeat deadlines, sequence counter.
const advanceRoom = `
local waiting, active, leases, sequence, turns = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local user, mode = ARGV[1], ARGV[2]
local capacity, checkoutMs, heartbeatMs, maxWaiting, startsAt =
  tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if now >= startsAt and mode ~= 'leave' and mode ~= 'complete' then return {'closed', 0, 0, now} end

-- Leaving and admitting the next live waiter happen in this same atomic script.
if mode == 'leave' or (mode == 'complete' and redis.call('HGET', turns, user) == ARGV[10]) then
  redis.call('ZREM', waiting, user)
  redis.call('ZREM', leases, user)
  redis.call('ZREM', active, user)
  redis.call('HDEL', turns, user)
end

-- Expire BEFORE renewing: a late poll cannot recover an abandoned position.
local abandoned = redis.call('ZRANGEBYSCORE', leases, '-inf', now)
for _, member in ipairs(abandoned) do redis.call('ZREM', waiting, member) end
redis.call('ZREMRANGEBYSCORE', leases, '-inf', now)
local expired = redis.call('ZRANGEBYSCORE', active, '-inf', now)
for _, member in ipairs(expired) do redis.call('HDEL', turns, member) end
redis.call('ZREMRANGEBYSCORE', active, '-inf', now)

local queued = redis.call('ZSCORE', waiting, user)
local admitted = redis.call('ZSCORE', active, user)
local full = false
if mode == 'join' and not queued and not admitted then
  if redis.call('ZCARD', waiting) >= maxWaiting then
    full = true
  else
    redis.call('ZADD', waiting, redis.call('INCR', sequence), user)
    queued = true
  end
end
if queued and mode ~= 'complete' then
  redis.call('ZADD', leases, math.min(now + heartbeatMs, startsAt), user)
end

-- A newcomer enters at the tail BEFORE promotion; polling faster cannot jump the queue.
local free = math.max(0, capacity - redis.call('ZCARD', active))
if free > 0 and now < startsAt and ARGV[8] == '1' then
  local nextUsers = redis.call('ZRANGE', waiting, 0, free - 1)
  for _, member in ipairs(nextUsers) do
    redis.call('ZREM', waiting, member)
    redis.call('ZREM', leases, member)
    redis.call('ZADD', active, math.min(now + checkoutMs, startsAt), member)
    redis.call('HSET', turns, member, ARGV[9] .. ':' .. member)
  end
end

-- Existing live turns from the previous version get an identity without extending time.
if redis.call('ZSCORE', active, user) and not redis.call('HGET', turns, user) then
  redis.call('HSET', turns, user, ARGV[9] .. ':' .. user)
end
-- Keep all room keys on the same lifetime, including an otherwise idle counter.
for _, key in ipairs(KEYS) do redis.call('PEXPIREAT', key, startsAt + 600000) end
if full then return {'full', 0, 0, now} end
local deadline = redis.call('ZSCORE', active, user)
if deadline then return {'admitted', 0, tonumber(deadline), now, redis.call('HGET', turns, user)} end
local rank = redis.call('ZRANK', waiting, user)
if rank then return {'waiting', rank + 1, tonumber(redis.call('ZSCORE', leases, user)), now} end
return {'not_joined', 0, 0, now}
`;

export function getWaitingRoom(userId: string, showId: string, startsAt: Date, join = false): Promise<WaitingRoomState> {
  return updateWaitingRoom(userId, showId, startsAt, join ? "join" : "status", true);
}

export function leaveWaitingRoom(userId: string, showId: string, startsAt: Date, hasAvailableSeats: boolean): Promise<WaitingRoomState> {
  return updateWaitingRoom(userId, showId, startsAt, "leave", hasAvailableSeats);
}

export function finishWaitingRoomTurn(userId: string, showId: string, startsAt: Date, canPromote: boolean, turnId: string) {
  return updateWaitingRoom(userId, showId, startsAt, "complete", canPromote, turnId);
}

async function updateWaitingRoom(userId: string, showId: string, startsAt: Date, operation: "join" | "status" | "leave" | "complete", canPromote: boolean, expectedTurn = ""): Promise<WaitingRoomState> {
  const result = await runRedis((connection) => connection.eval(advanceRoom, {
    keys: waitingRoomKeys(showId),
    arguments: [userId, operation, String(waitingRoomRules.capacity),
      String(waitingRoomRules.checkoutMs), String(waitingRoomRules.heartbeatMs),
      String(waitingRoomRules.maxWaiting), String(startsAt.getTime()), canPromote ? "1" : "0", randomUUID(), expectedTurn],
  })) as [WaitingRoomState["status"] | "full" | "closed", number, number, number, string?];
  const [status, position, expiresAt, now, turnId] = result;
  if (status === "full") throw new WaitingRoomFull();
  if (status === "closed") throw new WaitingRoomClosed();
  return {
    status, position: position || null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    serverTime: new Date(now).toISOString(), pollAfterMs: waitingRoomRules.pollAfterMs, turnId: turnId ?? null,
  };
}
