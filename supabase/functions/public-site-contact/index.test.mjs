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

test("retired public site contact fails closed with the canonical Go replacement", async () => {
  assert.equal(typeof registeredHandler, "function");

  const response = registeredHandler(
    new Request("https://example.test/functions/v1/public-site-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: "11111111-1111-4111-8111-111111111111",
        name: "Lead legado",
        phone: "5511999999999",
      }),
    }),
  );

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    success: false,
    code: "public_site_contact_endpoint_retired",
    error: "Esta rota foi desativada. Use a API publica atual do Vimob.",
    replacement: "/v1/public/site/contact",
  });
});

test("retired public site contact keeps preflight side-effect free", async () => {
  const response = registeredHandler(
    new Request("https://example.test/functions/v1/public-site-contact", {
      method: "OPTIONS",
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(await response.text(), "");
});

test("retired public site contact has no database, secret, network, or payload path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /createClient|Deno\.env|service.role|SUPABASE_SERVICE_ROLE_KEY|req(?:uest)?\.json|fetch\s*\(|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(/i,
  );
});
