import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import {
  whatsappQueryKeys,
} from "@/lib/whatsapp-query-cache";

type LocalWhatsAppMessage = WhatsAppMessage & {
  created_at?: string | null;
  lead_id?: string | null;
};

type LocalWhatsAppEvent = CustomEvent<LocalWhatsAppMessage>;

const MESSAGE_EVENTS = [
  "vimob:whatsapp-message-insert",
  "vimob:whatsapp-message-update",
] as const;

/**
 * Local WhatsApp cache bus.
 *
 * Backend data is fetched through HTTP APIs. Cross-user realtime should be
 * added through our backend with SSE/WebSocket when we decide to enable it.
 */
export function WhatsAppRealtimeBus() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!scope.organizationId || !scope.userId) return;

    const debouncedInvalidateConversations = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.conversationsScope(scope),
          refetchType: "active",
        });
        debounceRef.current = null;
      }, 500);
    };

    const handleMessageChange = (event: Event) => {
      const msg = (event as LocalWhatsAppEvent).detail;
      if (!msg?.conversation_id) return;

      queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.messagesForConversation(scope, msg.conversation_id),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.paginatedMessagesForConversation(scope, msg.conversation_id),
        refetchType: "active",
      });

      if (msg.lead_id) {
        queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.leadMessagesScope(scope, msg.lead_id),
          refetchType: "active",
        });
      }

      debouncedInvalidateConversations();
    };

    const handleConversationChange = () => {
      debouncedInvalidateConversations();
    };

    MESSAGE_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleMessageChange);
    });
    window.addEventListener("vimob:whatsapp-conversation-change", handleConversationChange);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      MESSAGE_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleMessageChange);
      });
      window.removeEventListener("vimob:whatsapp-conversation-change", handleConversationChange);
    };
  }, [scope, queryClient]);

  return null;
}
