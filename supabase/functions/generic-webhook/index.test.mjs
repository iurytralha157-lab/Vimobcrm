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

test("retired generic webhook fails closed with the canonical replacement", async () => {
  assert.equal(typeof registeredHandler, "function");

  const response = registeredHandler(
    new Request("https://example.test/functions/v1/generic-webhook?token=legacy", {
      method: "POST",
      headers: { Authorization: "Bearer legacy" },
      body: JSON.stringify({ name: "Lead legado", phone: "5511999999999" }),
    }),
  );

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    success: false,
    code: "generic_webhook_endpoint_retired",
    error: "Esta rota foi desativada. Use o endpoint publico atual do Vimob.",
    replacement: "/v1/public/webhooks/generic",
  });
});

test("retired generic webhook keeps preflight side-effect free", async () => {
  const response = registeredHandler(
    new Request("https://example.test/functions/v1/generic-webhook", {
      method: "OPTIONS",
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(await response.text(), "");
});

test("retired generic webhook has no database, secret, network, or payload path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /createClient|Deno\.env|service.role|req(?:uest)?\.json|fetch\s*\(|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(/i,
  );
});
