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

test("legacy public site data endpoint fails closed without exposing property data", async () => {
  assert.equal(typeof registeredHandler, "function");

  const response = registeredHandler(new Request("https://example.test/functions/v1/public-site-data"));

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    success: false,
    code: "public_site_data_endpoint_retired",
    error: "Esta rota foi desativada. Use a API publica atual do Vimob.",
  });
});

test("legacy public site data endpoint preserves a side-effect-free CORS preflight", async () => {
  const response = registeredHandler(new Request("https://example.test/functions/v1/public-site-data", {
    method: "OPTIONS",
  }));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert.equal(await response.text(), "");
});

test("unsupported methods cannot revive the retired data path", async () => {
  const response = registeredHandler(new Request("https://example.test/functions/v1/public-site-data", {
    method: "POST",
    body: JSON.stringify({ organization_id: "00000000-0000-4000-8000-000000000000" }),
  }));

  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, "public_site_data_endpoint_retired");
});

test("retired endpoint has no database, network, secret, or property projection path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /createClient|SUPABASE_SERVICE_ROLE_KEY|Deno\.env|fetch\s*\(|\.from\s*\(|\.select\s*\(/i,
  );
  assert.doesNotMatch(
    source,
    /owner|contact|documents?|metadata|local_chaves|comiss(?:ao|oes|ão|ões)|cpf|cnpj/i,
  );
});
