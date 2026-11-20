import { WHATSAPP_UNLINKED_LEAD_SNAPSHOT } from "@/lib/whatsapp-message-input";
import type { WhatsAppConversation } from "@/hooks/whatsapp/whatsapp-conversation-types";

export const getConversationLeadId = (conversation?: WhatsAppConversation | null) =>
  conversation?.lead_id || conversation?.lead?.id || null;

export const requireConversationLeadId = (conversation?: WhatsAppConversation | null) => {
  if (conversation?.historical_lead_view || conversation?.supervisory_lead_view) {
    throw new Error("WHATSAPP_HISTORICAL_CONVERSATION_READ_ONLY");
  }
  const leadId = getConversationLeadId(conversation);
  if (!leadId) throw new Error("WHATSAPP_CONVERSATION_LEAD_UNAVAILABLE");
  return leadId;
};

export const requireConversationBindingSnapshot = (conversation?: WhatsAppConversation | null) => {
  if (!conversation?.id) {
    throw new Error("WHATSAPP_CONVERSATION_UNAVAILABLE");
  }
  if (conversation.historical_lead_view || conversation.supervisory_lead_view) {
    throw new Error("WHATSAPP_HISTORICAL_CONVERSATION_READ_ONLY");
  }
  return getConversationLeadId(conversation) || WHATSAPP_UNLINKED_LEAD_SNAPSHOT;
};
