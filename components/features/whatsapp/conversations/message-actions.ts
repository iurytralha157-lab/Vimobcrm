import type { WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import type { WhatsAppQuotedMessage } from "@/lib/api/whatsapp";

export function canQuoteWhatsAppMessage(message: WhatsAppMessage) {
  return message.can_quote === true
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(message.id)
    && !message.metadata?.local_delivery_state
    && ["sent", "delivered", "read", "played", "received"].includes(message.status || "")
    && message.message_type !== "reaction";
}

export function toWhatsAppQuote(message: WhatsAppMessage): WhatsAppQuotedMessage {
  return { message_id: message.message_id, available: true, id: message.id,
    from_me: message.from_me, content: message.content || undefined,
    message_type: message.message_type, sender_name: message.sender_name || undefined,
    sender_user_id: message.sender_user_id || undefined,
    media_filename: message.media_filename || undefined };
}
