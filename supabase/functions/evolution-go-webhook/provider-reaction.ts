type ReactionInput = {
  messageId: string;
  providerMessageIdSynthetic?: boolean;
  reactionToMessageId: string | null;
  reactionEmoji: string | null;
  senderJid: string | null;
  senderName: string | null;
  remoteJid: string;
  fromMe: boolean;
  sentAt: string;
};
type ReactionScope = { organizationId: string; sessionId: string; sessionPhone: string | null };
type ReactionProvenance = { inboxEventKey: string; ingressSequence: number; executionId: string | null };
type ReactionClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

const canonicalPhoneJid = (value: string | null): string | null => {
  const text = (value || "").trim().toLowerCase().replace(/:\d+@/, "@").replace(/@c\.us$/, "@s.whatsapp.net");
  if (/^\d{5,15}@s\.whatsapp\.net$/.test(text)) return text;
  const digits = text.replace(/[^0-9]/g, "");
  return !text.includes("@") && /^\d{5,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
};

export function providerReactionActor(message: ReactionInput, sessionPhone: string | null): string {
  if (message.fromMe) {
    const actor = canonicalPhoneJid(message.senderJid) || canonicalPhoneJid(sessionPhone);
    if (!actor) throw new Error("whatsapp_reaction_self_identity_missing");
    return actor;
  }
  const actor = (message.senderJid || message.remoteJid).trim().toLowerCase().replace(/:\d+@/, "@").replace(/@c\.us$/, "@s.whatsapp.net");
  if (!actor || actor.length > 320 || !actor.includes("@")) throw new Error("whatsapp_reaction_actor_missing");
  return actor;
}

export async function persistProviderReaction(client: ReactionClient, scope: ReactionScope, message: ReactionInput, provenance: ReactionProvenance | null): Promise<"applied" | "duplicate" | "ignored"> {
  if (!provenance || !provenance.inboxEventKey || !Number.isSafeInteger(provenance.ingressSequence) || provenance.ingressSequence <= 0) {
    throw new Error("whatsapp_reaction_ingress_provenance_missing");
  }
  if (!message.messageId || message.providerMessageIdSynthetic || !message.reactionToMessageId) throw new Error("whatsapp_reaction_provider_identity_missing");
  if (!provenance.executionId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(provenance.executionId)) {
    throw new Error("whatsapp_reaction_execution_provenance_missing");
  }
  const result = await client.rpc("apply_whatsapp_provider_reaction", {
    p_organization_id: scope.organizationId, p_session_id: scope.sessionId,
    p_provider_message_id: message.messageId, p_target_provider_message_id: message.reactionToMessageId,
    p_actor_jid: providerReactionActor(message, scope.sessionPhone), p_actor_name: message.senderName,
    p_from_me: message.fromMe, p_emoji: message.reactionEmoji, p_reacted_at: message.sentAt,
    p_inbox_event_key: provenance.inboxEventKey, p_processing_epoch: 0, p_ingress_sequence: provenance.ingressSequence,
    p_execution_id: provenance.executionId,
  });
  if (result.error) throw result.error;
  const outcome = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>).outcome : null;
  if (outcome !== "applied" && outcome !== "duplicate" && outcome !== "ignored") throw new Error("whatsapp_reaction_result_invalid");
  return outcome;
}
