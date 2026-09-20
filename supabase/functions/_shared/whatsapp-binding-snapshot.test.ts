import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWhatsAppConversationBindingSnapshot,
  WhatsAppBindingSnapshotError,
} from "./whatsapp-binding-snapshot.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const leadA = "44444444-4444-4444-8444-444444444444";
const leadB = "55555555-5555-4555-8555-555555555555";
const bindingId = "66666666-6666-4666-8666-666666666666";

function conversation(leadId: string | null) {
  return {
    id: conversationId,
    organization_id: organizationId,
    session_id: sessionId,
    lead_id: leadId,
    updated_at: "2026-09-19T12:00:00.000000Z",
  };
}

function activeBinding(leadId = leadA) {
  return {
    id: bindingId,
    organization_id: organizationId,
    conversation_id: conversationId,
    session_id: sessionId,
    lead_id: leadId,
    active_to: null,
    stale: false,
  };
}

test("accepts a matching active card snapshot", () => {
  assert.deepEqual(
    assertWhatsAppConversationBindingSnapshot({
      conversation: conversation(leadA),
      activeBindings: [activeBinding()],
      expectedLeadId: leadA,
    }),
    {
      conversationId,
      organizationId,
      sessionId,
      leadId: leadA,
      bindingId,
      conversationUpdatedAt: "2026-09-19T12:00:00.000000Z",
    },
  );
});

test("preserves a genuinely unlinked conversation without inventing a card", () => {
  const snapshot = assertWhatsAppConversationBindingSnapshot({
    conversation: conversation(null),
    activeBindings: [],
    expectedLeadId: null,
  });

  assert.equal(snapshot.leadId, null);
  assert.equal(snapshot.bindingId, null);
});

for (const fixture of [
  {
    name: "rejects mutable conversation fallback when the outbox has no lead",
    conversation: conversation(leadA),
    bindings: [activeBinding()],
    expectedLeadId: null,
    code: "whatsapp_binding_lead_snapshot_mismatch",
  },
  {
    name: "rejects a card snapshot that differs from the active binding",
    conversation: conversation(leadA),
    bindings: [activeBinding()],
    expectedLeadId: leadB,
    code: "whatsapp_binding_lead_snapshot_mismatch",
  },
  {
    name: "rejects a linked conversation without an active ledger row",
    conversation: conversation(leadA),
    bindings: [],
    expectedLeadId: leadA,
    code: "whatsapp_binding_active_required",
  },
  {
    name: "rejects ambiguous active ledger rows",
    conversation: conversation(leadA),
    bindings: [activeBinding(), { ...activeBinding(), id: leadB }],
    expectedLeadId: leadA,
    code: "whatsapp_binding_active_ambiguous",
  },
  {
    name: "rejects a stale row presented as active",
    conversation: conversation(leadA),
    bindings: [{ ...activeBinding(), stale: true }],
    expectedLeadId: leadA,
    code: "whatsapp_binding_active_state_mismatch",
  },
]) {
  test(fixture.name, () => {
    assert.throws(
      () => assertWhatsAppConversationBindingSnapshot({
        conversation: fixture.conversation,
        activeBindings: fixture.bindings,
        expectedLeadId: fixture.expectedLeadId,
      }),
      (error) => error instanceof WhatsAppBindingSnapshotError &&
        error.code === fixture.code,
    );
  });
}
