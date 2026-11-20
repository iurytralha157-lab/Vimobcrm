import { useLayoutEffect, useMemo } from "react";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { getEffectiveMessageMediaKind } from "@/components/features/whatsapp/message-bubble/model";
import { getSafeMessageMediaUrl } from "@/components/features/whatsapp/message-media";
import type { MessageMediaGalleryItem } from "@/components/features/whatsapp/message-bubble/media-gallery-model";
import { createWhatsAppGalleryReadScope } from "@/lib/whatsapp-media-gallery-read";

export type WhatsAppGalleryMessage = {
  id: string;
  conversation_id?: string;
  message_type: string;
  media_url?: string | null;
  media_mime_type?: string | null;
  media_filename?: string | null;
  media_storage_path?: string | null;
  media_status?: "pending" | "ready" | "failed" | null;
  status?: string | null;
  delivery_error_code?: string | null;
  delivery_error_reason?: string | null;
  deleted_at?: string | null;
  metadata?: Record<string, unknown> | null;
};
const CONFIRMED_STATUSES = new Set(["received", "sent", "delivered", "read", "played"]);
const CANONICAL_ROW_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** A gallery contains only visible, canonical rows with usable media outcomes. */
export function getWhatsAppGalleryMedia(message: WhatsAppGalleryMessage, conversationId?: string | null) {
  if (!CANONICAL_ROW_ID.test(message.id) || message.deleted_at || message.message_type.toLowerCase() === "deleted"
    || conversationId && message.conversation_id !== conversationId
    || !CONFIRMED_STATUSES.has(message.status || "")
    || message.delivery_error_code || message.delivery_error_reason === "media_integrity_unverified"
    || message.metadata?.local_delivery_state) return null;
  const kind = getEffectiveMessageMediaKind(message.message_type, message.media_mime_type || null, message.media_url || null);
  if (kind !== "image" && kind !== "video") return null;
  const stored = Boolean(message.media_storage_path);
  const safeUrl = getSafeMessageMediaUrl(message.media_url || null, kind);
  if (message.media_status !== "ready" && !(message.media_status == null && !stored && safeUrl)) return null;
  if (!stored && !safeUrl) return null;
  return { kind, stored, safeUrl };
}

/** No prefetch, URL cache, phone lookup or new backend route. */
export function useWhatsAppMediaGallery({ messages, scopeKey, conversationId }: {
  messages: readonly WhatsAppGalleryMessage[];
  scopeKey: string;
  conversationId?: string | null;
}): readonly MessageMediaGalleryItem[] {
  const scope = useWhatsAppQueryScope();
  const reads = useMemo(() => createWhatsAppGalleryReadScope({ organizationId: scope.organizationId, userId: scope.userId,
    scopeKey: JSON.stringify([scope.accessScope, scopeKey, conversationId]) }, whatsappAPI.getMessageMediaURL),
    [scope.organizationId, scope.userId, scope.accessScope, scopeKey, conversationId]);
  useLayoutEffect(() => {
    reads.activate();
    return () => reads.dispose();
  }, [reads]);
  const items = useMemo(() => {
    if (!scope.organizationId || !scope.userId || !scopeKey) return [];
    const items: MessageMediaGalleryItem[] = [];
    const seen = new Set<string>();
    for (const message of messages) {
      const media = getWhatsAppGalleryMedia(message, conversationId);
      if (!media || seen.has(message.id)) continue;
      seen.add(message.id);
      items.push({ id: message.id, type: media.kind, filename: message.media_filename || undefined,
        url: media.stored ? "" : media.safeUrl!,
        refresh: media.stored ? reads.reader(message.id, media.kind, (url) => getSafeMessageMediaUrl(url, media.kind)) : undefined,
      });
    }
    return items;
  }, [messages, reads, conversationId, scope.organizationId, scope.userId, scopeKey]);
  useLayoutEffect(() => {
    reads.setVisible(items.map((item) => item.id));
  }, [items, reads]);
  return items;
}
