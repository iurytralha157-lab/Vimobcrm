"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { scheduleWhatsAppRealtimeRefresh } from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

export function useWhatsAppLeadActivityRealtime(
  enabled: boolean,
  selectedLeadId: string | null,
  selectedConversationId: string | null,
) {
  const queryClient = useQueryClient();
  const { organizationId, userId, accessScope } = useWhatsAppQueryScope();

  useEffect(() => {
    if (!enabled || !organizationId || !userId) return;
    const scope = { organizationId, userId, accessScope };
    const handleActivity = (event: Event) => {
      const change = (event as CustomEvent<{
        organizationId?: string;
        leadId?: string;
        reason?: string;
      }>).detail;
      if (change?.reason !== "lead.whatsapp_activity" || change.organizationId !== organizationId
        || !change.leadId || document.visibilityState === "hidden") return;

      // The existing backend stream emits this after commit. Treat it like a
      // Broadcast wake and let the scoped API read decide what is visible.
      const refreshSelectedLead = change.leadId === selectedLeadId;
      const conversationId = refreshSelectedLead ? selectedConversationId : null;
      scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
        refreshConversations: true,
        refreshMessages: Boolean(conversationId),
        refreshLeadMessages: refreshSelectedLead,
        conversationIds: conversationId ? [conversationId] : undefined,
        leadIds: refreshSelectedLead ? [change.leadId] : undefined,
      });
    };
    window.addEventListener("vimob:lead-realtime-change", handleActivity);
    return () => window.removeEventListener("vimob:lead-realtime-change", handleActivity);
  }, [accessScope, enabled, organizationId, queryClient, selectedConversationId, selectedLeadId, userId]);
}
