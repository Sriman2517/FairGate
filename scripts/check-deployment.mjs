import assert from "node:assert/strict";
// Keep this CLI alive while fetch's unreferenced timeout is pending.
const lifetime = setInterval(() => {}, 1000);

// Read-only checks: no account creation, booking, queue entry, or migrations.
function parseArguments() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--local") continue;
    if (!["--api", "--web"].includes(args[i]) || !args[i + 1] || values[args[i]]) throw new Error("Invalid arguments.");
    values[args[i]] = args[++i];
  }
  function origin(value) {
    const url = new URL(value);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/");
    assert.ok(url.protocol === "https:" || (local && loopback && url.protocol === "http:"));
    return url.origin;
  }
  return { api: origin(values["--api"]), web: origin(values["--web"]) };
}
async function get(url, timeout = 10000) {
  return fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeout) });
}
async function waitUntilReady(api) {
  // A single, bounded wake-up check for a user-requested deployment verification.
  // This is not a scheduled keep-alive ping.
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await get(`${api}/ready`, Math.min(10000, deadline - Date.now()));
      const data = await response.json();
      if (response.ok && data.status === "ready") return;
    } catch { /* Retry transient startup failures without printing connection details. */ }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(3000, remaining)));
  }
  throw new Error("API readiness did not pass within 90 seconds. Check the service logs and dependency settings.");
}
try {
  const { api, web } = parseArguments();
  console.log("Checking API readiness; a sleeping free service may need about a minute...");
  await waitUntilReady(api);
  const catalogue = await get(`${api}/movies`);
  assert.equal(catalogue.status, 200, "Catalogue must respond successfully.");
  const { movies } = await catalogue.json();
  assert.ok(Array.isArray(movies) && movies.length > 0, "Seed the demo catalogue before verifying deployment.");
  const homepage = await get(web);
  assert.equal(homepage.status, 200);
  const html = await homepage.text();
  assert.ok(html.includes("Back on the big screen"), "The website did not render the catalogue.");
  const login = await get(`${web}/login`);
  assert.equal(login.status, 200);
  assert.ok((await login.text()).includes('name="email"'), "The sign-in form did not render.");
  for (const name of ["rrr", "interstellar", "dune-part-two"]) {
    const poster = await get(`${web}/posters/${name}.jpg`);
    assert.equal(poster.status, 200);
    assert.match(poster.headers.get("content-type") ?? "", /^image\//);
    await poster.arrayBuffer();
  }
  console.log("PASS readiness, nonempty catalogue, homepage, sign-in form, and all three posters.");
  console.log("Next: browser HTTPS sign-in, group booking, and three-account waiting-room checks from the Phase 17 guide.");
} catch (error) {
  console.error(error instanceof assert.AssertionError || (error instanceof Error && error.message.startsWith("API readiness"))
    ? error.message : "Deployment check failed. Use --api https://API-HOST --web https://WEB-HOST. For local loopback HTTP only, add --local. Check URLs and service availability.");
  process.exitCode = 1;
} finally { clearInterval(lifetime); }
