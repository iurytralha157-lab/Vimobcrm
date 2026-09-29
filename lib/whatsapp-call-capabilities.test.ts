import assert from "node:assert/strict";
import test from "node:test";
import { isWhatsAppSessionFeatureEnabled } from "./whatsapp-call-capabilities";
import type { WhatsAppSession } from "./api/whatsapp";

const ownerId = "11111111-1111-4111-8111-111111111111";
const session = {
  provider: "evolution_go",
  owner_user_id: ownerId,
  advanced_settings: {},
} as WhatsAppSession;

test("calls and contact writes stay hidden until the specific session is enabled", () => {
  assert.equal(isWhatsAppSessionFeatureEnabled(session, "whatsapp_calls_enabled", ownerId), false);
  assert.equal(isWhatsAppSessionFeatureEnabled(session, "whatsapp_contact_save_enabled", ownerId), false);
  assert.equal(isWhatsAppSessionFeatureEnabled({
    ...session,
    advanced_settings: { whatsapp_calls_enabled: true },
  }, "whatsapp_calls_enabled", ownerId), true);
  assert.equal(isWhatsAppSessionFeatureEnabled({
    ...session,
    advanced_settings: { whatsapp_calls_enabled: true },
  }, "whatsapp_contact_save_enabled", ownerId), false);
});

test("flags cannot enable legacy providers or other session owners", () => {
  const enabled = { ...session, advanced_settings: { whatsapp_calls_enabled: true } };
  assert.equal(isWhatsAppSessionFeatureEnabled(enabled, "whatsapp_calls_enabled", "another-user"), false);
  assert.equal(isWhatsAppSessionFeatureEnabled({ ...enabled, provider: "evolution" }, "whatsapp_calls_enabled", ownerId), false);
});
