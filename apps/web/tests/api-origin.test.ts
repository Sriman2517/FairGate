import assert from "node:assert/strict";
import test from "node:test";
import { readApiOrigin } from "../src/lib/api-origin";

test("development defaults to loopback while production requires an explicit HTTPS origin", () => {
  assert.equal(readApiOrigin({}), "http://127.0.0.1:4000");
  assert.throws(() => readApiOrigin({ NODE_ENV: "production" }), /FAIRGATE_API_URL/);
  assert.equal(readApiOrigin({ NODE_ENV: "production", FAIRGATE_API_URL: "https://api.example.test/" }), "https://api.example.test");
  assert.throws(() => readApiOrigin({ NODE_ENV: "production", FAIRGATE_API_URL: "http://api.internal" }), /HTTPS/);
  assert.equal(readApiOrigin({ NODE_ENV: "production", FAIRGATE_API_URL: "http://api.internal:4000", FAIRGATE_ALLOW_HTTP_API: "true" }), "http://api.internal:4000");
});

test("API origins reject embedded credentials, paths, query strings, and unsupported schemes", () => {
  for (const value of ["not-a-url", "file:///tmp/api", "https://user:secret@api.test", "https://api.test/v1", "https://api.test/?token=secret", "https://api.test/#secret"]) {
    assert.throws(() => readApiOrigin({ FAIRGATE_API_URL: value }), (error: unknown) => error instanceof Error && !error.message.includes("secret"));
  }
});
