export function readApiOrigin(env: Record<string, string | undefined> = process.env): string {
  const value = env.FAIRGATE_API_URL ?? (env.NODE_ENV === "production" ? undefined : "http://127.0.0.1:4000");
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("Set FAIRGATE_API_URL to the API origin."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("FAIRGATE_API_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:" && env.FAIRGATE_ALLOW_HTTP_API !== "true") {
    throw new Error("Production requires an HTTPS API URL. Set FAIRGATE_ALLOW_HTTP_API=true only for an explicitly protected private connection.");
  }
  return url.origin;
}
