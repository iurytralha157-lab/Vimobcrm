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

test("retired WordPress importer rejects former bulk payloads", async () => {
  assert.equal(typeof registeredHandler, "function");

  const response = registeredHandler(
    new Request("https://example.test/functions/v1/import-wordpress-properties", {
      method: "POST",
      body: JSON.stringify({
        organization_id: "00000000-0000-4000-8000-000000000000",
        properties: [{ title: "Untrusted" }],
      }),
    }),
  );

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    success: false,
    code: "wordpress_property_import_retired",
    error: "Esta rota de importacao foi desativada.",
  });
});

test("retired WordPress importer keeps preflight side-effect free", async () => {
  const response = registeredHandler(
    new Request("https://example.test/functions/v1/import-wordpress-properties", {
      method: "OPTIONS",
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(await response.text(), "");
});

test("retired WordPress importer has no database, secret, network, or payload path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /createClient|Deno\.env|service.role|req\.json|fetch\s*\(|\.from\s*\(|\.insert\s*\(|\.select\s*\(/i,
  );
  assert.doesNotMatch(source, /organization.id|properties\.map|insertedProps|batch/i);
});
