import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { root } from "./helpers/evolution-proxy-harness.mjs";

test("the canonical proxy stays an authenticated fail-closed tombstone and legacy sender stays unroutable", async () => {
  const [config, source, rawManifest] = await Promise.all([
    readFile(path.join(root, "supabase/config.toml"), "utf8"),
    readFile(path.join(root, "supabase/functions/evolution-go-proxy/index.ts"), "utf8"),
    readFile(path.join(root, "supabase/functions/production-manifest.json"), "utf8"),
  ]);
  const entries = JSON.parse(rawManifest).functions;
  const proxy = entries.find(entry => entry.slug === "evolution-go-proxy");
  assert.equal(proxy.status, "ACTIVE");
  assert.equal(proxy.lifecycle, "TOMBSTONE");
  assert.equal(proxy.verify_jwt, true);
  assert.equal(proxy.auth_boundary, "GATEWAY_JWT");
  assert.match(config, /^\[functions\.evolution-go-proxy\]\r?\nverify_jwt\s*=\s*true\s*$/m);
  assert.match(source, /serveRetiredWhatsAppFunction\("evolution-go-proxy"\)/);
  assert.equal(entries.find(entry => entry.slug === "message-sender").status, "RETIRED");
  assert.doesNotMatch(config, /^\[functions\.(?:message-sender|evolution-webhook)\]\s*$/m);
});
