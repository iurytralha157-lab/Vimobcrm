import assert from "node:assert/strict";
import test from "node:test";

import {
  getWhatsAppStatusPresentation,
  getWhatsAppStatusScopeCopy,
  summarizeWhatsAppSessionStatuses,
} from "./session-status-presentation";

test("normalizes provider connection states without treating unknown as connected", () => {
  assert.deepEqual(getWhatsAppStatusPresentation("OPEN"), {
    label: "Conectado",
    tone: "connected",
  });
  assert.equal(getWhatsAppStatusPresentation("qr_ready").tone, "waiting");
  assert.equal(getWhatsAppStatusPresentation("logged_out").tone, "disconnected");
  assert.equal(getWhatsAppStatusPresentation("provider_new_state").tone, "unknown");
});

test("counts every non-connected state as requiring attention", () => {
  const session = {
    id: "11111111-1111-4111-8111-111111111111",
    display_name: "Atendimento",
    phone_number: null,
    profile_name: null,
    last_connected_at: null,
    updated_at: "2026-09-12T12:00:00Z",
    owner: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Maria",
    },
    capabilities: {
      can_manage: false,
      can_set_notification_sender: false,
    },
  };

  assert.deepEqual(
    summarizeWhatsAppSessionStatuses([
      { ...session, status: "connected" },
      { ...session, status: "qr_ready" },
      { ...session, status: "unexpected" },
    ]),
    { total: 3, connected: 1, attention: 2 },
  );
});

test("scope copy never promises access to conversations", () => {
  for (const scope of ["organization", "team", "self"] as const) {
    assert.doesNotMatch(getWhatsAppStatusScopeCopy(scope), /mensagens/i);
  }
  assert.match(getWhatsAppStatusScopeCopy("organization"), /sem acesso às conversas/i);
});
