type ReactionMessage = {
  id: string;
  message_id?: string | null;
  sent_at?: string | null;
  from_me?: boolean | null;
  content?: string | null;
  sender_jid?: string | null;
  sender_name?: string | null;
  reaction_to_message_id?: string | null;
  reaction_emoji?: string | null;
  reaction_sender_jid?: string | null;
  reaction_sender_name?: string | null;
  metadata?: Record<string, unknown> | null;
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

export function groupLatestWhatsAppReactions(messages: ReactionMessage[]) {
  const reactionsByTarget = new Map<string, Map<string, GroupedWhatsAppReaction>>();
  const orderedMessages = [...messages].sort((left, right) => {
    const sentAtDifference = new Date(left.sent_at || 0).getTime() - new Date(right.sent_at || 0).getTime();
    return sentAtDifference || left.id.localeCompare(right.id);
  });

  for (const message of orderedMessages) {
    const targetId =
      message.reaction_to_message_id ||
      metadataString(message.metadata, "reaction_to_message_id") ||
      metadataString(message.metadata, "target_message_id") ||
      metadataString(message.metadata, "targetMessageId");
    if (!targetId) continue;

    const fromMe = Boolean(message.from_me);
    const senderName = message.reaction_sender_name || message.sender_name || null;
    const senderKey =
      message.reaction_sender_jid ||
      message.sender_jid ||
      (fromMe ? "self" : senderName ? `name:${senderName}` : `event:${message.id}`);
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
