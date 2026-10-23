import assert from "node:assert/strict";
import test from "node:test";
import { assertNoEffects, loadProxy, proxyRequest } from "./helpers/evolution-proxy-harness.mjs";

test("retired QR, status and send responses contain no provider body, IDs, credentials or diagnostics", async () => {
  const { handler, effects } = await loadProxy();
  for (const action of ["instance.qr", "instance.status", "send.text"]) {
    const response = await handler(proxyRequest(action));
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const body = await response.json();
    assert.deepEqual(body, {
      ok: false, error: "whatsapp_edge_function_retired",
      function: "evolution-go-proxy", canonical_service: "vimob_go_backend",
    });
  }
  assertNoEffects(effects);
});
