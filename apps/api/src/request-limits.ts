import { createHash, randomUUID } from "node:crypto";
import { runRedis } from "./redis.js";

export const requestLimits = {
  "waiting-room": { requests: 60, windowMs: 60_000 },
  booking: { requests: 20, windowMs: 60_000 },
} as const;
export type RequestScope = keyof typeof requestLimits;

export class RequestLimitExceeded extends Error {
  constructor(public readonly retryAfterSeconds: number) { super("Too many requests. Please wait before trying again."); }
}

export function requestLimitKey(userId: string, scope: RequestScope) {
  const account = createHash("sha256").update(userId).digest("hex");
  return `fairgate:request-limit:${scope}:${account}`;
}

// Count accepted attempts in (now - window, now], using Redis's clock.
// Prune, count and append must be atomic across all API processes.
const slidingWindow = `
local key = KEYS[1]
local limit, windowMs = tonumber(ARGV[1]), tonumber(ARGV[2])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
if redis.call('ZCARD', key) >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return math.max(1, math.ceil((tonumber(oldest[2]) + windowMs - now) / 1000))
end
redis.call('ZADD', key, now, ARGV[3])
redis.call('PEXPIRE', key, windowMs)
return 0
`;

export async function enforceRequestLimit(userId: string, scope: RequestScope) {
  const rule = requestLimits[scope];
  const retryAfter = await runRedis((connection) => connection.eval(slidingWindow, {
    keys: [requestLimitKey(userId, scope)],
    // A server-generated member distinguishes attempts arriving in the same millisecond.
    arguments: [String(rule.requests), String(rule.windowMs), randomUUID()],
  })) as number;
  if (retryAfter > 0) throw new RequestLimitExceeded(retryAfter);
}
