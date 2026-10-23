import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppSoundGate, isFreshWhatsAppSoundMessage, parseWhatsAppSoundMessage } from "./whatsapp-sound-message";

const inbound = { operation: "INSERT", fromMe: false, direction: "inbound", captureState: "captured", messageId: "message-a", organizationId: "org-a", attendantUserId: "user-a", createdAt: new Date(20_000).toISOString() };

test("audio accepts only an explicit new captured inbound", () => {
  assert.ok(parseWhatsAppSoundMessage(inbound));
  for (const patch of [{ operation: "UPDATE" }, { fromMe: true }, { fromMe: undefined }, { direction: "outbound" }, { captureState: "observed_unattended" }, { captureState: "promoted_unlinked" }, { attendantUserId: null }, { createdAt: "invalid" }]) {
    assert.equal(parseWhatsAppSoundMessage({ ...inbound, ...patch }), null);
  }
});
test("audio rejects another tenant, another attendant and reconnect replay", () => {
  const message = parseWhatsAppSoundMessage(inbound)!;
  assert.equal(isFreshWhatsAppSoundMessage(message, "org-a", "user-a", 20_000, 21_000), true);
  assert.equal(isFreshWhatsAppSoundMessage(message, "org-b", "user-a", 20_000, 21_000), false);
  assert.equal(isFreshWhatsAppSoundMessage(message, "org-a", "user-b", 20_000, 21_000), false);
  assert.equal(isFreshWhatsAppSoundMessage(message, "org-a", "user-a", 30_000, 31_000), false);
  assert.equal(isFreshWhatsAppSoundMessage(message, "org-a", "user-a", 0, 0), false);
  assert.equal(isFreshWhatsAppSoundMessage(message, "org-a", "user-a", 0, 60_000), false);
});
test("audio gate deduplicates SSE and private broadcast without replaying throttled messages", () => {
  const gate = createWhatsAppSoundGate("org-a", "user-a", 20_000);
  assert.equal(gate(inbound, 21_000), true);
  assert.equal(gate(inbound, 24_000), false);
  const second = { ...inbound, messageId: "second", createdAt: new Date(21_500).toISOString() };
  assert.equal(gate(second, 21_500), false);
  assert.equal(gate(second, 24_000), false);
  assert.equal(gate({ ...inbound, messageId: "third", createdAt: new Date(24_000).toISOString() }, 24_000), true);
  assert.equal(gate({ ...inbound, messageId: "old-replayed" }, 60_000), false);
});
