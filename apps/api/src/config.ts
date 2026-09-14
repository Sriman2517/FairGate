import "dotenv/config";
import { isIP } from "node:net";

export function readApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const host = env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
  const port = env.PORT ?? "4000";
  if (!isIP(host)) throw new Error("HOST must be an IP address, such as 127.0.0.1 or 0.0.0.0.");
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("PORT must be an integer from 1 to 65535.");

  function serviceUrl(name: string, value: string | undefined, schemes: string[]) {
    let url: URL;
    try { url = new URL(value ?? ""); } catch { throw new Error(`${name} must be set to a valid service URL.`); }
    if (!schemes.includes(url.protocol) || !url.hostname || url.hash) throw new Error(`${name} uses an unsupported service URL.`);
    return url;
  }
  const databaseUrl = serviceUrl("DATABASE_URL", env.DATABASE_URL, ["postgres:", "postgresql:"]);
  if (databaseUrl.pathname.length < 2) throw new Error("DATABASE_URL must name a database.");
  const redisUrl = serviceUrl("REDIS_URL", env.REDIS_URL ?? (production ? undefined : "redis://127.0.0.1:6380"), ["redis:", "rediss:"]);
  if (production && decodeURIComponent(databaseUrl.password) === "fairgate_dev") throw new Error("Production requires its own database credentials, not the local demo password.");
  const authLimitNamespace = env.AUTH_LIMIT_NAMESPACE ?? "main";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(authLimitNamespace)) throw new Error("AUTH_LIMIT_NAMESPACE must contain 1–80 letters, numbers, underscores, or hyphens.");
  return { host, port: Number(port), databaseUrl: databaseUrl.href, redisUrl: redisUrl.href, authLimitNamespace };
}
