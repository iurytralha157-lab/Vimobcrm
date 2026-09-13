type ReactionMessage = {
  id: string;
  message_id?: string | null;
  sent_at?: string | null;
  from_me?: boolean | null;
  content?: string | null;
  sender_jid?: string | null;
  sender_name?: string | null;
  status?: string | null;
  reaction_to_message_id?: string | null;
  reaction_emoji?: string | null;
  reaction_sender_jid?: string | null;
  reaction_sender_name?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ReactableMessage = {
  id?: string | null;
  message_id?: string | null;
  client_message_id?: string | null;
  status?: string | null;
};

export type GroupedWhatsAppReaction = {
  emoji: string;
  senderName: string | null;
  fromMe: boolean;
};

const metadataString = (metadata: Record<string, unknown> | null | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
};

const NON_REACTABLE_MESSAGE_STATUSES = new Set(["pending", "confirming", "failed", "error"]);

/**
 * Reactions target a persisted WhatsApp message row. Optimistic messages use
 * the client id in every identifier slot until the API returns the canonical
 * row, so exposing the picker before reconciliation would send an invalid
 * target to the backend.
 */
export function canReactToWhatsAppMessage(message: ReactableMessage) {
  const rowId = message.id?.trim() || "";
  const providerMessageId = message.message_id?.trim() || "";
  const clientMessageId = message.client_message_id?.trim() || "";
  const status = message.status?.trim().toLowerCase() || "";

  if (!rowId || !providerMessageId || NON_REACTABLE_MESSAGE_STATUSES.has(status)) return false;
  if (clientMessageId && rowId === clientMessageId && providerMessageId === clientMessageId) return false;
  return true;
}

export function groupLatestWhatsAppReactions(messages: ReactionMessage[]) {
  const reactionsByTarget = new Map<string, Map<string, GroupedWhatsAppReaction>>();
  const orderedMessages = [...messages].sort((left, right) => {
    const sentAtDifference = new Date(left.sent_at || 0).getTime() - new Date(right.sent_at || 0).getTime();
    return sentAtDifference || left.id.localeCompare(right.id);
  });

  for (const message of orderedMessages) {
    if (message.status === "failed" || message.status === "error") continue;
    const targetId =
      message.reaction_to_message_id ||
      metadataString(message.metadata, "reaction_to_message_id") ||
      metadataString(message.metadata, "target_message_id") ||
      metadataString(message.metadata, "targetMessageId");
    if (!targetId) continue;

    const fromMe = Boolean(message.from_me);
    const senderName = message.reaction_sender_name || message.sender_name || null;
    const senderKey = fromMe
      ? "self"
      : message.reaction_sender_jid ||
        message.sender_jid ||
        (senderName ? `name:${senderName}` : `event:${message.id}`);
    const reactionsBySender = reactionsByTarget.get(targetId) || new Map<string, GroupedWhatsAppReaction>();
    const emoji = message.reaction_emoji || message.content || "";

    if (emoji) {
      reactionsBySender.set(senderKey, { emoji, senderName, fromMe });
    } else {
      reactionsBySender.delete(senderKey);
    }

    if (reactionsBySender.size > 0) {
      reactionsByTarget.set(targetId, reactionsBySender);
    } else {
      reactionsByTarget.delete(targetId);
    }
  }

  return new Map(
    Array.from(reactionsByTarget, ([targetId, reactionsBySender]) => [
      targetId,
      Array.from(reactionsBySender.values()),
    ]),
  );
}
