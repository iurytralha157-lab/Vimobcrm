import type { WhatsAppMessage } from '@/hooks/use-whatsapp-conversations';
import { normalizeSearchText } from '@/lib/search-text';

export function matchesWhatsAppMessageSearch(message: Pick<WhatsAppMessage, 'content' | 'message_type' | 'media_filename'>, query: string) {
  const needle = normalizeSearchText(query).trim();
  return Boolean(needle) && message.message_type !== 'deleted'
    && normalizeSearchText(`${message.content || ''} ${message.media_filename || ''}`).includes(needle);
}

export function findWhatsAppMessageIdentity(messages: readonly WhatsAppMessage[], id: string,
  context?: { conversationId?: string | null; sessionId?: string | null }) {
  const candidates = messages.filter(message => (!context?.conversationId || message.conversation_id === context.conversationId)
    && (!context?.sessionId || message.session_id === context.sessionId));
  const exact = candidates.find(message => message.id === id);
  if (exact) return exact;
  const provider = candidates.filter(message => message.message_id === id);
  return provider.length === 1 ? provider[0] : undefined;
}
