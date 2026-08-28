import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

let registeredHandler;
const previousDeno = globalThis.Deno;

globalThis.Deno = {
  serve(handler) {
    registeredHandler = handler;
  },
};

await import("./index.ts");

after(() => {
  if (previousDeno === undefined) {
    delete globalThis.Deno;
    return;
  }

  globalThis.Deno = previousDeno;
});

test("retired Instagram OAuth endpoint fails closed without redirecting", async () => {
  assert.equal(typeof registeredHandler, "function");

  const response = registeredHandler(
    new Request("https://example.test/functions/v1/instagram-oauth?code=fake&state=fake"),
  );

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    success: false,
    code: "instagram_oauth_endpoint_retired",
    error: "Esta rota foi desativada. Use a integracao Meta atual do Vimob.",
  });
});

test("retired Instagram OAuth endpoint preserves a side-effect-free preflight", async () => {
  const response = registeredHandler(
    new Request("https://example.test/functions/v1/instagram-oauth", { method: "OPTIONS" }),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(await response.text(), "");
});

test("retired Instagram OAuth endpoint rejects every former action", async () => {
  const response = registeredHandler(
    new Request("https://example.test/functions/v1/instagram-oauth", {
      method: "POST",
      body: JSON.stringify({ action: "get_auth_url" }),
    }),
  );

  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, "instagram_oauth_endpoint_retired");
});

test("retired Instagram OAuth endpoint has no credential, database, network, or redirect path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /createClient|Deno\.env|service.role|app.secret|access.token|fetch\s*\(|\.from\s*\(|\.upsert\s*\(/i,
  );
  assert.doesNotMatch(source, /status:\s*30[1278]|\bLocation\b|returnUrl|redirectWithData|\batob\b|\bbtoa\b/);
});
