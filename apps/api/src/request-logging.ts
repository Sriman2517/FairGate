import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";

export interface RequestLog {
  event: "http_request";
  timestamp: string;
  requestId: string;
  method: string;
  route: string;
  statusCode: number | null;
  durationMs: number;
  outcome: "completed" | "aborted";
}

type LogWriter = (entry: RequestLog) => void;
const standardMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

// Call with a literal mount path from app.ts, never with a request URL or parameter.
export function logRouteGroup(group: string): RequestHandler {
  return (_request, response, next) => {
    response.locals.logRouteGroup = group;
    next();
  };
}

export function requestLogging(write: LogWriter = (entry) => console.info(JSON.stringify(entry))): RequestHandler {
  return (request, response, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    let logged = false;
    // Incoming IDs are untrusted. Each API attempt receives a new server-generated ID.
    response.set("X-Request-ID", requestId);

    function record(outcome: RequestLog["outcome"]) {
      if (logged) return;
      logged = true;
      const group: string = response.locals.logRouteGroup ?? "";
      // Express stores the declared route pattern here, not the actual customer URL.
      const pattern: unknown = request.route?.path;
      const route = typeof pattern === "string" ? `${group}${pattern}` : group ? `${group}/*` : "unmatched";
      const entry: RequestLog = {
        event: "http_request", timestamp: new Date().toISOString(), requestId,
        method: standardMethods.has(request.method) ? request.method : "OTHER",
        route, statusCode: outcome === "completed" ? response.statusCode : null,
        durationMs: Math.round((performance.now() - started) * 100) / 100, outcome,
      };
      // A broken log destination must not turn a completed response into a crash.
      try { write(entry); } catch { /* Logging is best-effort in this phase. */ }
    }

    response.once("finish", () => record("completed"));
    response.once("close", () => record(response.writableFinished ? "completed" : "aborted"));
    next();
  };
}
