"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  connectBackendRealtime,
  type BackendRealtimeEvent,
} from "@/lib/api/realtime";
import { useAuth } from "@/contexts/AuthContext";
import { notifyLeadRealtimeChange } from "@/contexts/LeadRealtimeBus";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/config/constants";
import {
  getTargetedMembershipAccessChange,
  reconcileMembershipAccessChange,
  type MembershipAccessChange,
} from "@/lib/auth/membership-realtime";
import { getBackendRealtimeResetDelay } from "@/lib/pipeline-reliability";
import { invalidateScheduleDashboardCaches } from "@/hooks/schedule/invalidate-schedule-dashboard";

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
  "dashboard-lead-distribution",
  "dashboard-recent-activities",
  "recent-activities",
  "top-brokers",
  "upcoming-tasks",
  "dashboard-alerts",
  "lead-analytics",
  "site-analytics",
  "site-analytics-detailed",
] as const;

type AccessRefreshCoordinatorOptions = {
  isCurrentScope: () => boolean;
  refresh: () => Promise<unknown>;
};

type AccessRefreshCoordinator = {
  request: (onFailure?: () => void) => Promise<void>;
  dispose: () => void;
};

export function createCoalescedAccessRefresh({
  isCurrentScope,
  refresh,
}: AccessRefreshCoordinatorOptions): AccessRefreshCoordinator {
  let active = true;
  let refreshRequested = false;
  let inFlight: Promise<void> | null = null;
  const pendingFailureHandlers = new Set<() => void>();

  const drain = async () => {
    while (active && isCurrentScope() && refreshRequested) {
      refreshRequested = false;
      const failureHandlers = [...pendingFailureHandlers];
      pendingFailureHandlers.clear();

      try {
        await refresh();
      } catch {
        if (!active || !isCurrentScope()) return;
        failureHandlers.forEach((handleFailure) => {
          try {
            handleFailure();
          } catch {
            // A fallback must not stop a pending trailing refresh.
          }
        });
      }
    }
  };

  const request = (onFailure?: () => void) => {
    if (!active || !isCurrentScope()) return Promise.resolve();

    refreshRequested = true;
    if (onFailure) pendingFailureHandlers.add(onFailure);
    if (!inFlight) {
      inFlight = drain().finally(() => {
        inFlight = null;
      });
    }

    return inFlight;
  };

  return {
    request,
    dispose: () => {
      active = false;
      refreshRequested = false;
      pendingFailureHandlers.clear();
    },
  };
}

export function BackendRealtimeBus() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { activeOrganization, profile, refreshProfile, refreshOrganizations } =
    useAuth();
  const scheduleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const realtimeResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeResetDueAtRef = useRef<number | null>(null);
  const lastRealtimeResetAtRef = useRef<number | null>(null);
  const refreshProfileRef = useRef(refreshProfile);
  const refreshOrganizationsRef = useRef(refreshOrganizations);
  const queryClientRef = useRef(queryClient);
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  const accessScopeGenerationRef = useRef(0);

  useEffect(() => {
    refreshProfileRef.current = refreshProfile;
  }, [refreshProfile]);

  useEffect(() => {
    refreshOrganizationsRef.current = refreshOrganizations;
  }, [refreshOrganizations]);

  useEffect(() => {
    queryClientRef.current = queryClient;
  }, [queryClient]);

  useEffect(() => {
    routerRef.current = router;
    pathnameRef.current = pathname;
  }, [pathname, router]);

  useEffect(() => {
    if (!profile?.id || !activeOrganization.organizationId) return;

    const organizationId = activeOrganization.organizationId;
    const userId = profile.id;
    const scopeGeneration = ++accessScopeGenerationRef.current;
    const isCurrentScope = () =>
      accessScopeGenerationRef.current === scopeGeneration;
    const accessRefresh = createCoalescedAccessRefresh({
      isCurrentScope,
      refresh: () => refreshCurrentUserAccess(refreshProfileRef),
    });
    const requestAccessRefresh = (onFailure?: () => void) => {
      void accessRefresh.request(onFailure);
    };
    const redirectToOrganizationSelection = () => {
      if (!isCurrentScope()) return;

      const params = new URLSearchParams({
        redirectTo: pathnameRef.current || DEFAULT_AUTHENTICATED_ROUTE,
      });
      routerRef.current.replace(`/select-organization?${params.toString()}`);
    };
    const invalidateOrganizations = async () => {
      if (!isCurrentScope()) return;
      await queryClientRef.current.invalidateQueries({
        queryKey: ["user-organizations", userId],
        refetchType: "active",
      });
    };
    const refreshOrganizationsForCurrentScope = async () => {
      if (!isCurrentScope()) return;
      await refreshOrganizationsRef.current();
    };
    const handleMembershipAccessRefresh = (change: MembershipAccessChange) => {
      if (!isCurrentScope()) return;

      if (change.revoked) {
        // Access revocation is safety-critical: leave this tenant before any
        // previously running profile refresh can delay the navigation.
        redirectToOrganizationSelection();
        void Promise.allSettled([
          invalidateOrganizations(),
          refreshOrganizationsForCurrentScope(),
        ]);
        return;
      }

      void reconcileMembershipAccessChange(change, {
        invalidateOrganizations,
        refreshOrganizations: refreshOrganizationsForCurrentScope,
        refreshAccess: () => accessRefresh.request(),
        redirectToOrganizationSelection,
      }).catch(() => undefined);
    };
    const scheduleRealtimeReset = () => {
      const nowMs = Date.now();
      const delayMs = getBackendRealtimeResetDelay(
        nowMs,
        lastRealtimeResetAtRef.current,
      );
      const dueAtMs = nowMs + delayMs;

      // Keep the earliest pending reconciliation. Repeated reset notices often
      // describe the same replay gap and must not fan out into request storms.
      if (
        realtimeResetRef.current &&
        realtimeResetDueAtRef.current !== null &&
        realtimeResetDueAtRef.current <= dueAtMs
      ) {
        return;
      }
      if (realtimeResetRef.current) clearTimeout(realtimeResetRef.current);

      realtimeResetDueAtRef.current = dueAtMs;
      realtimeResetRef.current = setTimeout(() => {
        realtimeResetRef.current = null;
        realtimeResetDueAtRef.current = null;
        lastRealtimeResetAtRef.current = Date.now();

        requestAccessRefresh();
        const activeQueryClient = queryClientRef.current;
        void activeQueryClient.invalidateQueries(
          {
            predicate: (query) => query.queryKey[0] !== "stages-with-leads",
            refetchType: "active",
          },
          { cancelRefetch: false },
        );
        notifyLeadRealtimeChange({
          organizationId,
          reason: "realtime.reset",
        });
      }, delayMs);
    };

    const disconnect = connectBackendRealtime({
      organizationId,
      onEvent: (event) => {
        const activeQueryClient = queryClientRef.current;
        if (!isCurrentScope() || event.organizationId !== organizationId)
          return;
        if (event.type === "realtime.connected") {
          requestAccessRefresh();
          return;
        }
        if (event.type === "realtime.ping") return;
        if (event.type === "realtime.reset") {
          scheduleRealtimeReset();
          return;
        }

        if (event.type === "organization.users.changed") {
          void activeQueryClient.invalidateQueries({
            queryKey: ["organization-users", organizationId],
            refetchType: "active",
          });
          void activeQueryClient.invalidateQueries({
            queryKey: ["invitations", organizationId],
            refetchType: "active",
          });
          return;
        }

        const membershipChange = getTargetedMembershipAccessChange(
          event,
          userId,
          organizationId,
        );
        if (membershipChange) {
          handleMembershipAccessRefresh(membershipChange);
          return;
        }

        if (event.type === "access.permissions.changed") {
          const targetUserId =
            getString(event.data, "targetUserId") || event.userId;
          if (targetUserId === userId) {
            requestAccessRefresh(() => {
              void queryClientRef.current.invalidateQueries({
                queryKey: ["user-permissions", userId, organizationId],
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
          void activeQueryClient.invalidateQueries({
            queryKey: ["webhooks"],
            refetchType: "active",
          });
          return;
        }

        if (event.type.startsWith("notification.")) {
          const targetUserId =
            getString(event.data, "targetUserId") ||
            getString(event.data, "userId") ||
            event.userId;
          if (targetUserId && targetUserId !== userId) return;

          invalidateNotificationQueries(activeQueryClient);
          return;
        }
      },
      onError: () => {
        // The connector retries by itself; visible errors would be noisy here.
      },
    });

    return () => {
      if (accessScopeGenerationRef.current === scopeGeneration) {
        accessScopeGenerationRef.current += 1;
      }
      accessRefresh.dispose();
      if (scheduleDebounceRef.current) {
        clearTimeout(scheduleDebounceRef.current);
        scheduleDebounceRef.current = null;
      }
      if (realtimeResetRef.current) {
        clearTimeout(realtimeResetRef.current);
        realtimeResetRef.current = null;
      }
      realtimeResetDueAtRef.current = null;
      lastRealtimeResetAtRef.current = null;
      disconnect();
    };
  }, [profile?.id, activeOrganization.organizationId]);

  return null;
}

async function refreshCurrentUserAccess(
  refreshProfileRef: MutableRefObject<() => Promise<unknown>>,
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
    void queryClient.invalidateQueries({
      queryKey: ["schedule-events"],
      refetchType: "active",
    });
    invalidateScheduleDashboardCaches(queryClient);
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

function handleWhatsAppEvent(
  event: BackendRealtimeEvent,
  queryClient: QueryClient,
) {
  const conversationId = getString(event.data, "conversationId");
  const sessionId = getString(event.data, "sessionId");
  const leadId = getString(event.data, "leadId");

  if (WHATSAPP_MESSAGE_EVENTS.has(event.type) && conversationId) {
    window.dispatchEvent(
      new CustomEvent("vimob:whatsapp-message-insert", {
        detail: {
          conversation_id: conversationId,
          lead_id: leadId || null,
          organization_id: event.organizationId,
          id:
            getString(event.data, "messageId") ||
            getString(event.data, "clientMessageId"),
        },
      }),
    );
  } else {
    window.dispatchEvent(
      new CustomEvent("vimob:whatsapp-conversation-change", {
        detail: {
          conversation_id: conversationId,
          lead_id: leadId || null,
          organization_id: event.organizationId,
        },
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
    void queryClient.invalidateQueries({
      queryKey: ["whatsapp-sessions"],
      refetchType: "active",
    });
    void queryClient.invalidateQueries({
      queryKey: ["accessible-sessions"],
      refetchType: "active",
    });
  }

  if (event.type === "whatsapp.session_access.changed") {
    void queryClient.invalidateQueries({
      queryKey: ["whatsapp-session-access"],
      refetchType: "active",
    });
  }

  if (event.type.startsWith("whatsapp.template")) {
    void queryClient.invalidateQueries({
      queryKey: ["message-templates"],
      refetchType: "active",
    });
  }

  if (
    event.type.startsWith("whatsapp.labels") ||
    event.type === "whatsapp.groups.synced"
  ) {
    if (sessionId) {
      void queryClient.invalidateQueries({
        queryKey: ["whatsapp-labels", sessionId],
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["whatsapp-groups", sessionId],
        refetchType: "active",
      });
    } else {
      void queryClient.invalidateQueries({
        queryKey: ["whatsapp-labels"],
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["whatsapp-groups"],
        refetchType: "active",
      });
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
  void queryClient.invalidateQueries({
    queryKey: ["notifications"],
    refetchType: "active",
  });
  void queryClient.invalidateQueries({
    queryKey: ["unread-notifications-count"],
    refetchType: "active",
  });
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
