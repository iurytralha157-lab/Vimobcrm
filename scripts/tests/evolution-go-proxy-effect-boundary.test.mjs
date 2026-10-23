import assert from "node:assert/strict";
import test from "node:test";
import { assertNoEffects, loadProxy, organizations, proxyRequest } from "./helpers/evolution-proxy-harness.mjs";

test("token, instance and organization overrides cannot cross the retired provider boundary", async () => {
  const { handler, effects } = await loadProxy();
  const actions = ["send.text", "send.media", "send.audio", "send.sticker", "send.location", "send.contact", "send.link", "send.poll", "message.edit", "message.delete", "message.react", "message.markread", "instance.create", "instance.logout", "instance.connect", "instance.qr", "instance.status"];
  for (const action of actions) {
    const response = await handler(proxyRequest(action, organizations[0], {
      session_id: organizations[1], organization_id: organizations[1],
      instance_id: "other-owner-instance", token: "forged-provider-token",
      body: { number: "5511999990000", text: "Synthetic fixture", id: "0123456789ABCDEF0123456789ABCDEF" },
    }));
    assert.equal(response.status, 410, action);
    assertNoEffects(effects);
  }
});

test("retirement handles malformed payloads and preflight without reading secrets or the body", async () => {
  const { handler, effects } = await loadProxy();
  for (const method of ["GET", "OPTIONS", "POST"]) {
    const request = new Request("https://functions.example.test/evolution-go-proxy", { method });
    request.json = () => { throw new Error("retirement must not inspect caller input"); };
    assert.equal((await handler(request)).status, 410);
  }
  assertNoEffects(effects);
});
