import { format, isToday, isYesterday } from "date-fns";

import type { MetaConversation } from "@/hooks/use-meta-conversations";
import type {
  WhatsAppConversation,
  WhatsAppMessage,
} from "@/hooks/use-whatsapp-conversations";

export type ConversationPlatform = "whatsapp" | "instagram" | "facebook" | "meta";

export type ScreenConversation = WhatsAppConversation & {
  external_id?: string;
  platform?: MetaConversation["platform"];
};

export type DisplayMessage = Pick<
  WhatsAppMessage,
  "content" | "from_me" | "id" | "media_mime_type" | "media_url" | "message_type" | "sent_at"
> &
  Partial<
    Pick<
      WhatsAppMessage,
      | "media_error"
      | "media_status"
      | "message_id"
      | "reaction_emoji"
      | "reaction_sender_jid"
      | "reaction_sender_name"
      | "reaction_to_message_id"
      | "session_id"
      | "sender_jid"
      | "sender_name"
    >
  > & {
    metadata?: Record<string, unknown>;
    status: string | null;
  };

export type ConversationListFilters = {
  onlyLeads: boolean;
  withoutLeadOnly: boolean;
  pendingReplyOnly: boolean;
};

export type ConversationSearchNormalizer = (value: string) => string;

const getSearchDigits = (value: string) => value.replace(/\D/g, "");

export const getConversationAvatarUrl = (conversation?: WhatsAppConversation | null) =>
  conversation?.lead?.whatsapp_avatar_url || conversation?.contact_picture || undefined;

export const hasConversationLead = (conversation: ScreenConversation) =>
  Boolean(conversation.lead_id || conversation.lead?.id);

export function filterWhatsAppConversations(
  conversations: ScreenConversation[],
  filters: ConversationListFilters,
) {
  let filtered = conversations;

  if (filters.onlyLeads) {
    filtered = filtered.filter(hasConversationLead);
  }
  if (filters.withoutLeadOnly) {
    filtered = filtered.filter((conversation) => !hasConversationLead(conversation));
  }
  if (filters.pendingReplyOnly) {
    filtered = filtered.filter((conversation) => (conversation.unread_count ?? 0) > 0);
  }

  return filtered;
}

export function matchesConversationSearch(
  conversation: ScreenConversation,
  rawSearch: string,
  normalizeSearchText: ConversationSearchNormalizer,
) {
  const search = normalizeSearchText(rawSearch);
  if (!search) return true;

  const searchDigits = getSearchDigits(search);
  const searchableText = normalizeSearchText([
    conversation.contact_name,
    conversation.contact_phone,
    conversation.lead?.name,
    conversation.last_message,
    conversation.remote_jid,
  ]
    .filter(Boolean)
    .join(" "));

  if (searchableText.includes(search)) return true;
  if (!searchDigits) return false;

  const searchableDigits = getSearchDigits([
    conversation.contact_phone,
    conversation.remote_jid,
    conversation.last_message,
  ]
    .filter(Boolean)
    .join(" "));

  return searchableDigits.includes(searchDigits);
}

export function toScreenConversation(conversation: MetaConversation): ScreenConversation {
  return {
    id: conversation.id,
    session_id: "",
    lead_id: conversation.lead_id,
    remote_jid: conversation.external_id,
    contact_name: conversation.contact_name,
    contact_phone: null,
    contact_picture: conversation.contact_picture,
    contact_presence: null,
    presence_updated_at: null,
    last_message: conversation.last_message,
    last_message_at: conversation.last_message_at,
    unread_count: conversation.unread_count,
    is_group: false,
    archived_at: conversation.is_archived ? conversation.updated_at : null,
    deleted_at: null,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    lead: conversation.lead ? { id: conversation.lead.id, name: conversation.lead.name } : undefined,
    external_id: conversation.external_id,
    platform: conversation.platform,
  };
}

export function formatConversationTime(date: string | null) {
  if (!date) return "";
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return "";
  if (isToday(parsedDate)) return format(parsedDate, "HH:mm");
  if (isYesterday(parsedDate)) return "Ontem";
  return format(parsedDate, "dd/MM");
}

export function formatConversationPreview(message: string | null) {
  if (!message) return "Sem mensagens";
  const trimmed = message.trim();
  if (/^[a-f0-9-]{36}\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|opus|pdf|doc|docx|xls|xlsx|csv|avi|mov|aac|m4a|wav|heic)$/i.test(trimmed)
    || /^\S+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|opus|pdf|doc|docx|xls|xlsx|csv|avi|mov|aac|m4a|wav|heic)$/i.test(trimmed)) {
    const extension = trimmed.split(".").pop()?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(extension)) return "Foto";
    if (["mp4", "avi", "mov"].includes(extension)) return "Vídeo";
    if (["mp3", "ogg", "opus", "aac", "m4a", "wav"].includes(extension)) return "Áudio";
    return "Documento";
  }
  return message;
}
