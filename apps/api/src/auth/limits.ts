import { createHash } from "node:crypto";
import { readApiConfig } from "../config.js";
import { runRedis } from "../redis.js";

export const authLimits = { login: 10, register: 5, accountWindowMs: 900_000, service: 120, serviceWindowMs: 60_000 } as const;
const namespace = readApiConfig().authLimitNamespace;

export class AuthLimitExceeded extends Error {
  constructor(public readonly retryAfterSeconds: number) { super("Too many authentication attempts."); }
}
export class AuthUnavailable extends Error {}

export function authLimitKeys(kind: "login" | "register", email: string) {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const prefix = `fairgate:auth-limit:{${namespace}}`;
  return [`${prefix}:service`, `${prefix}:${kind}:${digest}`];
}

// Two fixed windows, updated together. Rejected calls neither extend TTLs nor
// spend the other budget. The service cap also bounds new email-key creation.
const takeAttempt = `
local service, account = tonumber(redis.call('GET', KEYS[1]) or '0'), tonumber(redis.call('GET', KEYS[2]) or '0')
local retry = 0
if service >= tonumber(ARGV[1]) then retry = math.max(retry, redis.call('PTTL', KEYS[1])) end
if account >= tonumber(ARGV[3]) then retry = math.max(retry, redis.call('PTTL', KEYS[2])) end
if service >= tonumber(ARGV[1]) or account >= tonumber(ARGV[3]) then return math.max(1, math.ceil(retry / 1000)) end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
return 0
`;

export async function enforceAuthLimit(kind: "login" | "register", email: string) {
  let retry: number;
  try {
    retry = await runRedis((connection) => connection.eval(takeAttempt, {
      keys: authLimitKeys(kind, email),
      arguments: [String(authLimits.service), String(authLimits.serviceWindowMs), String(authLimits[kind]), String(authLimits.accountWindowMs)],
    })) as number;
  } catch { throw new AuthUnavailable("Authentication limits are unavailable."); }
  if (retry > 0) throw new AuthLimitExceeded(retry);
}
