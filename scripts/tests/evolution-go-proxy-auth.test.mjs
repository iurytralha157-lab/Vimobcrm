import assert from "node:assert/strict";
import test from "node:test";
import { assertNoEffects, loadProxy, organizations, proxyRequest } from "./helpers/evolution-proxy-harness.mjs";

test("canonical proxy denies signed browser users from both organizations before every external effect", async () => {
  const { handler, effects } = await loadProxy();
  for (const organizationId of organizations) {
    const response = await handler(proxyRequest("send.text", organizationId));
    assert.equal(response.status, 410, "the browser must use Go attendance/outbox instead of the legacy proxy");
    const data = await response.json();
    assert.equal(data.error, "whatsapp_edge_function_retired");
  }
  assertNoEffects(effects);
});

test("service credentials and anonymous callers cannot resurrect the retired proxy", async () => {
  const { handler, effects } = await loadProxy();
  for (const headers of [{}, { apikey: "local-fixture-secret-key" }, { authorization: "Bearer legacy-service-role-fixture" }]) {
    const response = await handler(new Request("https://functions.example.test/evolution-go-proxy", { method: "POST", headers, body: "invalid-json" }));
    assert.equal(response.status, 410);
  }
  assertNoEffects(effects);
});
