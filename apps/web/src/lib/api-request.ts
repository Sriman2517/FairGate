import "server-only";
import { connection } from "next/server";
import { readApiOrigin } from "./api-origin";

export async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  // Resolve deployment configuration at request time, not during prerendering.
  await connection();
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("API paths must be relative to the configured origin.");
  const origin = readApiOrigin();
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error("API requests must stay on the configured origin.");
  return fetch(url, { ...options, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
}
