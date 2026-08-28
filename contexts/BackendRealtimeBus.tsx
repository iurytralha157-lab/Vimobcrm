"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { connectBackendRealtime, type BackendRealtimeEvent } from "@/lib/api/realtime";
import { useAuth } from "@/contexts/AuthContext";
import { notifyLeadRealtimeChange } from "@/contexts/LeadRealtimeBus";

const WHATSAPP_MESSAGE_EVENTS = new Set([
  "whatsapp.message.sent",
  "whatsapp.message.created",
  "whatsapp.message.updated",
  "whatsapp.message.received",
]);

const DASHBOARD_REALTIME_QUERY_KEYS = [
  "dashboard-stats",
  "enhanced-dashboard-stats",
  "leads-chart-data",
  "funnel-data",
  "lead-sources-data",
  "deals-evolution",
  "dashboard-extra-counts",
  "dashboard-recent-activities",
  "recent-activities",
  "top-brokers",
  "upcoming-tasks",
  "dashboard-alerts",
  "lead-analytics",
  "site-analytics",
  "site-analytics-detailed",
] as const;

export function BackendRealtimeBus() {
  const queryClient = useQueryClient();
  const { profile, refreshProfile } = useAuth();
  const scheduleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshProfileRef = useRef(refreshProfile);
  const queryClientRef = useRef(queryClient);
  const accessRefreshQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    refreshProfileRef.current = refreshProfile;
  }, [refreshProfile]);

  useEffect(() => {
    queryClientRef.current = queryClient;
  }, [queryClient]);

  useEffect(() => {
    if (!profile?.organization_id) return;

    const organizationId = profile.organization_id;
    const enqueueAccessRefresh = (onFailure?: () => void) => {
      accessRefreshQueueRef.current = accessRefreshQueueRef.current
        .catch(() => undefined)
        .then(() => refreshCurrentUserAccess(refreshProfileRef))
        .catch(() => {
          onFailure?.();
        });
    };

    const disconnect = connectBackendRealtime({
      organizationId,
      onEvent: (event) => {
        const activeQueryClient = queryClientRef.current;
        if (event.organizationId !== organizationId) return;
        if (event.type === "realtime.connected") {
          enqueueAccessRefresh();
          return;
        }
        if (event.type === "realtime.ping") return;
        if (event.type === "realtime.reset") {
          enqueueAccessRefresh();
          void activeQueryClient.invalidateQueries({ refetchType: "active" });
          return;
        }

        if (event.type === "access.permissions.changed") {
          const targetUserId = getString(event.data, "targetUserId") || event.userId;
          if (targetUserId === profile.id) {
            enqueueAccessRefresh(() => {
              void queryClientRef.current.invalidateQueries({
                queryKey: ["user-permissions", profile.id, organizationId],
                refetchType: "active",
              });
            });
          }
          return;
        }

        if (event.type.startsWith("lead.")) {
          handleLeadEvent(event);
          return;
        }

        if (event.type.startsWith("schedule.")) {
          handleScheduleEvent(event, activeQueryClient, scheduleDebounceRef);
          return;
        }

        if (event.type.startsWith("whatsapp.")) {
          handleWhatsAppEvent(event, activeQueryClient);
          return;
        }

        if (event.type.startsWith("site.")) {
          invalidateDashboardRealtimeQueries(activeQueryClient);
          return;
        }

        if (event.type.startsWith("webhook.")) {
          void activeQueryClient.invalidateQueries({ queryKey: ["webhooks"], refetchType: "active" });
          return;
        }

        if (event.type.startsWith("notification.")) {
          const targetUserId = getString(event.data, "targetUserId")
            || getString(event.data, "userId")
            || event.userId;
          if (targetUserId && targetUserId !== profile.id) return;

          invalidateNotificationQueries(activeQueryClient);
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
  }, [profile?.id, profile?.organization_id]);

  return null;
}

async function refreshCurrentUserAccess(
  refreshProfileRef: MutableRefObject<() => Promise<void>>,
) {
  await refreshProfileRef.current();
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
  queryClient: QueryClient,
  debounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  if (debounceRef.current) clearTimeout(debounceRef.current);

  debounceRef.current = setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: ["schedule-events"], refetchType: "active" });
    invalidateDashboardRealtimeQueries(queryClient);

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

function handleWhatsAppEvent(event: BackendRealtimeEvent, queryClient: QueryClient) {
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

function invalidateNotificationQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["notifications"], refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["unread-notifications-count"], refetchType: "active" });
}

function invalidateDashboardRealtimeQueries(queryClient: QueryClient) {
  DASHBOARD_REALTIME_QUERY_KEYS.forEach((queryKey) => {
    void queryClient.invalidateQueries({
      queryKey: [queryKey],
      refetchType: "active",
    });
  });
}

function getString(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" && value ? value : undefined;
}
