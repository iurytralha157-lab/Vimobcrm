import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assertNoEffects, loadProxy, organizations, proxyRequest, root } from "./helpers/evolution-proxy-harness.mjs";

test("retries with deterministic IDs cannot recreate the removed Edge dispatch lane", async () => {
  const { handler, effects } = await loadProxy();
  const bodies = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await handler(proxyRequest("send.text", organizations[0], {
      body: { text: "Synthetic fixture", id: "0123456789ABCDEF0123456789ABCDEF", clientMessageId: "fixture-client-id" },
    }));
    assert.equal(response.status, 410);
    bodies.push(await response.text());
  }
  assert.equal(new Set(bodies).size, 1);
  assertNoEffects(effects);
});

test("legacy private sender is not routable and canonical Go dispatch does not depend on the proxy", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "supabase/functions/production-manifest.json"), "utf8"));
  const sender = manifest.functions.find(entry => entry.slug === "message-sender");
  assert.equal(sender.status, "RETIRED");
  assert.equal(sender.auth_boundary, "NOT_ROUTABLE");
  const functions = await readFile(path.join(root, "apps/api/internal/whatsapp/functions.go"), "utf8");
  const provider = await readFile(path.join(root, "apps/api/internal/whatsapp/evolution_go.go"), "utf8");
  assert.doesNotMatch(functions + provider, /evolution-go-proxy/);
  assert.match(provider, /func \(client functionsClient\) invokeEvolution/);
});
