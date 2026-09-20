export type WhatsAppConversationBindingRow = {
  id?: unknown;
  conversation_id?: unknown;
  organization_id?: unknown;
  session_id?: unknown;
  lead_id?: unknown;
  active_to?: unknown;
  stale?: unknown;
};

export type WhatsAppConversationBindingSubject = {
  id?: unknown;
  organization_id?: unknown;
  session_id?: unknown;
  lead_id?: unknown;
  updated_at?: unknown;
};

export type WhatsAppConversationBindingSnapshot = {
  conversationId: string;
  organizationId: string;
  sessionId: string | null;
  leadId: string | null;
  bindingId: string | null;
  conversationUpdatedAt: string | null;
};

export class WhatsAppBindingSnapshotError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "WhatsAppBindingSnapshotError";
    this.code = code;
  }
}

function requiredText(value: unknown, code: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new WhatsAppBindingSnapshotError(code);
  return normalized;
}

function optionalText(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

/**
 * Validates one immutable view of a physical WhatsApp thread before a worker
 * crosses an external side-effect boundary. A linked conversation must have
 * exactly one matching active binding. A genuinely unlinked conversation is
 * valid only while both the caller snapshot and the binding ledger are empty.
 */
export function assertWhatsAppConversationBindingSnapshot(input: {
  conversation: WhatsAppConversationBindingSubject | null | undefined;
  activeBindings: WhatsAppConversationBindingRow[] | null | undefined;
  expectedLeadId: string | null;
}): WhatsAppConversationBindingSnapshot {
  const conversation = input.conversation;
  if (!conversation) {
    throw new WhatsAppBindingSnapshotError("whatsapp_binding_conversation_missing");
  }

  const conversationId = requiredText(
    conversation.id,
    "whatsapp_binding_conversation_id_missing",
  );
  const organizationId = requiredText(
    conversation.organization_id,
    "whatsapp_binding_organization_id_missing",
  );
  const sessionId = optionalText(conversation.session_id);
  const conversationLeadId = optionalText(conversation.lead_id);
  const expectedLeadId = optionalText(input.expectedLeadId);
  const activeBindings = input.activeBindings ?? [];

  if (activeBindings.length > 1) {
    throw new WhatsAppBindingSnapshotError("whatsapp_binding_active_ambiguous");
  }

  const active = activeBindings[0] ?? null;
  if (!conversationLeadId) {
    if (expectedLeadId || active) {
      throw new WhatsAppBindingSnapshotError("whatsapp_binding_unlinked_state_mismatch");
    }

    return {
      conversationId,
      organizationId,
      sessionId,
      leadId: null,
      bindingId: null,
      conversationUpdatedAt: optionalText(conversation.updated_at),
    };
  }

  if (!expectedLeadId || expectedLeadId !== conversationLeadId) {
    throw new WhatsAppBindingSnapshotError("whatsapp_binding_lead_snapshot_mismatch");
  }
  if (!active) {
    throw new WhatsAppBindingSnapshotError("whatsapp_binding_active_required");
  }

  const bindingId = requiredText(active.id, "whatsapp_binding_id_missing");
  if (
    optionalText(active.organization_id) !== organizationId ||
    optionalText(active.conversation_id) !== conversationId ||
    optionalText(active.session_id) !== sessionId ||
    optionalText(active.lead_id) !== conversationLeadId ||
    active.active_to !== null ||
    active.stale === true
  ) {
    throw new WhatsAppBindingSnapshotError("whatsapp_binding_active_state_mismatch");
  }

  return {
    conversationId,
    organizationId,
    sessionId,
    leadId: conversationLeadId,
    bindingId,
    conversationUpdatedAt: optionalText(conversation.updated_at),
  };
}
