// The API uses Retry-After's integer-seconds form. Invalid values get a short fallback.
export function retryAfterSeconds(response: Response) {
  const value = response.headers.get("retry-after") ?? "";
  return /^\d+$/.test(value) ? Math.max(1, Math.min(3600, Number(value))) : 5;
}
