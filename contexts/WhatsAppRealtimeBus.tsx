import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  scheduleWhatsAppRealtimeRefresh,
  useWhatsAppInboxRealtime,
  type WhatsAppMessage,
} from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

type LocalWhatsAppMessage = WhatsAppMessage & {
  created_at?: string | null;
  lead_id?: string | null;
  organization_id?: string | null;
};

type LocalWhatsAppEvent = CustomEvent<LocalWhatsAppMessage>;
type LocalWhatsAppConversationEvent = CustomEvent<{
  conversation_id?: string | null;
  lead_id?: string | null;
  organization_id?: string | null;
}>;

const MESSAGE_EVENTS = [
  "vimob:whatsapp-message-insert",
  "vimob:whatsapp-message-update",
] as const;

/**
 * Local WhatsApp cache bus.
 *
 * Backend data is fetched through HTTP APIs. This component is also the single
 * app-shell owner of the organization inbox wake-up channel.
 */
export function WhatsAppRealtimeBus() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  useWhatsAppInboxRealtime(true);

  useEffect(() => {
    if (!scope.organizationId || !scope.userId) return;

    const handleMessageChange = (event: Event) => {
      const msg = (event as LocalWhatsAppEvent).detail;
      if (!msg?.conversation_id) return;
      if (msg.organization_id && msg.organization_id !== scope.organizationId) return;

      scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
        refreshConversations: true,
        refreshMessages: true,
        refreshLeadMessages: Boolean(msg.lead_id),
        conversationIds: [msg.conversation_id],
        leadIds: msg.lead_id ? [msg.lead_id] : undefined,
      });
    };

    const handleConversationChange = (event: Event) => {
      const detail = (event as LocalWhatsAppConversationEvent).detail;
      if (detail?.organization_id && detail.organization_id !== scope.organizationId) return;
      scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
        refreshConversations: true,
      });
    };

    MESSAGE_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleMessageChange);
    });
    window.addEventListener("vimob:whatsapp-conversation-change", handleConversationChange);

    return () => {
      MESSAGE_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleMessageChange);
      });
      window.removeEventListener("vimob:whatsapp-conversation-change", handleConversationChange);
    };
  }, [scope, queryClient]);

  return null;
}
