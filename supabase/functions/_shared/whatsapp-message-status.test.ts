import assert from "node:assert/strict";
import test from "node:test";

import {
  monotonicWhatsAppMessageStatus,
  monotonicWhatsAppOutboxStatus,
} from "./whatsapp-message-status";

test("does not regress acknowledged WhatsApp delivery states", () => {
  const cases = [
    ["sent", "pending", "sent"],
    ["sent", "queued", "sent"],
    ["sent", "received", "sent"],
    ["delivered", "sent", "delivered"],
    ["delivered", "pending", "delivered"],
    ["read", "failed", "read"],
  ] as const;

  for (const [current, incoming, expected] of cases) {
    assert.equal(monotonicWhatsAppMessageStatus(current, incoming), expected);
  }
});

test("does not reopen an outbox row while a worker is processing it", () => {
  const protectedStates = ["processing", "retry", "sent", "delivered", "read", "failed", "dead"];
  for (const current of protectedStates) {
    assert.equal(monotonicWhatsAppOutboxStatus(current, "pending"), current);
    assert.equal(monotonicWhatsAppOutboxStatus(current, "queued"), current);
  }
  assert.equal(monotonicWhatsAppOutboxStatus("processing", "sent"), "sent");
});

test("keeps terminal failures until the full delivery state can be reconciled", () => {
  assert.equal(monotonicWhatsAppMessageStatus("sent", "failed"), "failed");
  assert.equal(monotonicWhatsAppMessageStatus("failed", "pending"), "failed");
  assert.equal(monotonicWhatsAppMessageStatus("failed", "sent"), "failed");
  assert.equal(monotonicWhatsAppMessageStatus("failed", "delivered"), "failed");
  assert.equal(monotonicWhatsAppMessageStatus("failed", "read"), "failed");
  assert.equal(monotonicWhatsAppOutboxStatus("dead", "read"), "dead");
});
