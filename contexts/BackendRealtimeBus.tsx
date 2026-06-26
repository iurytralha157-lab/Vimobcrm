"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectBackendRealtime, type BackendRealtimeEvent } from "@/lib/api/realtime";
import { useAuth } from "@/contexts/AuthContext";
import { notifyLeadRealtimeChange } from "@/contexts/LeadRealtimeBus";

const WHATSAPP_MESSAGE_EVENTS = new Set([
  "whatsapp.message.sent",
  "whatsapp.message.created",
  "whatsapp.message.updated",
  "whatsapp.message.received",
]);

export function BackendRealtimeBus() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scheduleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!profile?.organization_id) return;

    const organizationId = profile.organization_id;

    const disconnect = connectBackendRealtime({
      organizationId,
      onEvent: (event) => {
        if (event.organizationId !== organizationId) return;
        if (event.type === "realtime.connected" || event.type === "realtime.ping") return;

        if (event.type.startsWith("lead.")) {
          handleLeadEvent(event);
          return;
        }

        if (event.type.startsWith("schedule.")) {
          handleScheduleEvent(event, queryClient, scheduleDebounceRef);
          return;
        }

        if (event.type.startsWith("whatsapp.")) {
          handleWhatsAppEvent(event, queryClient);
          return;
        }

        if (event.type.startsWith("webhook.")) {
          void queryClient.invalidateQueries({ queryKey: ["webhooks"], refetchType: "active" });
          return;
        }
      },
      onError: () => {
        // The connector retries by itself; visible errors would be noisy here.
      },
    });

    return () => {
      if (scheduleDebounceRef.current) {
        clearTimeout(scheduleDebounceRef.current);
        scheduleDebounceRef.current = null;
      }
      disconnect();
    };
  }, [profile?.organization_id, queryClient]);

  return null;
}

function handleLeadEvent(event: BackendRealtimeEvent) {
  notifyLeadRealtimeChange({
    organizationId: event.organizationId,
    leadId: getString(event.data, "leadId"),
    reason: event.type,
  });
}

function handleScheduleEvent(
  event: BackendRealtimeEvent,
  queryClient: ReturnType<typeof useQueryClient>,
  debounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  if (debounceRef.current) clearTimeout(debounceRef.current);

  debounceRef.current = setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: ["schedule-events"], refetchType: "active" });

    const eventId = getString(event.data, "eventId");
    if (eventId) {
      void queryClient.invalidateQueries({
        queryKey: ["schedule_comments", event.organizationId, eventId],
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["schedule_assignees", event.organizationId, eventId],
        refetchType: "active",
      });
    }

    const leadId = getString(event.data, "leadId");
    if (leadId) {
      notifyLeadRealtimeChange({
        organizationId: event.organizationId,
        leadId,
        reason: event.type,
      });
    }

    debounceRef.current = null;
  }, 150);
}

function handleWhatsAppEvent(event: BackendRealtimeEvent, queryClient: ReturnType<typeof useQueryClient>) {
  const conversationId = getString(event.data, "conversationId");
  const sessionId = getString(event.data, "sessionId");
  const leadId = getString(event.data, "leadId");

  if (WHATSAPP_MESSAGE_EVENTS.has(event.type) && conversationId) {
    window.dispatchEvent(
      new CustomEvent("vimob:whatsapp-message-insert", {
        detail: {
          conversation_id: conversationId,
          lead_id: leadId || null,
          id: getString(event.data, "messageId") || getString(event.data, "clientMessageId"),
        },
      }),
    );
  } else {
    window.dispatchEvent(
      new CustomEvent("vimob:whatsapp-conversation-change", {
        detail: { conversation_id: conversationId, lead_id: leadId || null },
      }),
    );
  }

  if (leadId) {
    notifyLeadRealtimeChange({
      organizationId: event.organizationId,
      leadId,
      reason: event.type,
    });
  }

  if (event.type.startsWith("whatsapp.session")) {
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["accessible-sessions"], refetchType: "active" });
  }

  if (event.type === "whatsapp.session_access.changed") {
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-session-access"], refetchType: "active" });
    if (sessionId) {
      void queryClient.invalidateQueries({
        queryKey: ["whatsapp-session-access", sessionId],
        refetchType: "active",
      });
    }
  }

  if (event.type.startsWith("whatsapp.template")) {
    void queryClient.invalidateQueries({ queryKey: ["message-templates"], refetchType: "active" });
  }

  if (event.type.startsWith("whatsapp.labels") || event.type === "whatsapp.groups.synced") {
    if (sessionId) {
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-labels", sessionId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", sessionId], refetchType: "active" });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-labels"], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-groups"], refetchType: "active" });
    }
    if (conversationId) {
      void queryClient.invalidateQueries({
        queryKey: ["whatsapp-chat-labels", conversationId],
        refetchType: "active",
      });
    }
  }
}

function getString(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" && value ? value : undefined;
}
