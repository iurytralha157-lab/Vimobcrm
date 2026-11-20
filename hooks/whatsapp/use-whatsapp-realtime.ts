import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { reportErrorEvent } from "@/lib/api/telemetry";
import { canSubscribeToWhatsAppRealtime } from "@/lib/access/whatsapp-realtime";
import { createClient } from "@/lib/supabase/client";
import { getPrivateBroadcastRegistry } from "@/lib/supabase/private-broadcast";
import type {
  PrivateBroadcastDiagnostic,
  PrivateBroadcastStatus,
} from "@/lib/realtime/private-broadcast-registry";
import { createWhatsAppInboxSubscriptionCatchUp } from "@/lib/realtime/whatsapp-refresh-coordinator";
import {
  isWhatsAppInboxWakePayload,
  isWhatsAppQueryKeyForScope,
  WHATSAPP_MESSAGES_RECONCILE_EVENT,
  whatsappInboxTopic,
  whatsappQueryKeys,
} from "@/lib/whatsapp-query-cache";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { scheduleWhatsAppRealtimeRefresh } from "@/hooks/whatsapp/whatsapp-message-cache";

const realtimeDiagnosticReportedAt = new Map<string, number>();

const WHATSAPP_REALTIME_DIAGNOSTIC_THROTTLE_MS = 60_000;

function getWhatsAppRealtimeChannelScope(topic: string) {
  return topic.split(":")[2] === "lead" ? "lead" : "inbox";
}

function getWhatsAppRealtimeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 120),
      message: error.message.slice(0, 500),
    };
  }
  return {
    name: "UnknownError",
    message: String(error ?? "Unknown Realtime error").slice(0, 500),
  };
}

function reportWhatsAppRealtimeDiagnostic(diagnostic: PrivateBroadcastDiagnostic) {
  const channelScope = getWhatsAppRealtimeChannelScope(diagnostic.topic);
  const organizationId = diagnostic.topic.split(":")[1] || undefined;
  const throttleKey = `${organizationId ?? "unknown"}:${diagnostic.kind}:${channelScope}`;
  const now = Date.now();
  const lastReportedAt = realtimeDiagnosticReportedAt.get(throttleKey) ?? 0;
  if (now - lastReportedAt < WHATSAPP_REALTIME_DIAGNOSTIC_THROTTLE_MS) return;
  realtimeDiagnosticReportedAt.set(throttleKey, now);

  const normalizedError = getWhatsAppRealtimeError(diagnostic.error);
  void reportErrorEvent({
    organizationId,
    source: "frontend",
    severity: diagnostic.kind === "auth_error" || diagnostic.kind === "open_error"
      ? "error"
      : "warning",
    category: "supabase_realtime",
    message: `WhatsApp Realtime ${diagnostic.kind}: ${normalizedError.message}`,
    errorCode: `WHATSAPP_REALTIME_${diagnostic.kind.toUpperCase()}`,
    component: "WhatsAppPrivateRealtime",
    fingerprint: `frontend:whatsapp-realtime:${diagnostic.kind}:${channelScope}`,
    metadata: {
      channelScope,
      event: diagnostic.event,
      status: diagnostic.status,
      errorName: normalizedError.name,
    },
  }).catch(() => undefined);
}

function useCanSubscribeWhatsAppRealtime(enabled: boolean) {
  const { isLoading: modulesLoading, hasModule } = useOrganizationModules();
  const { isLoading: permissionsLoading, hasPermission } = useUserPermissions();

  return canSubscribeToWhatsAppRealtime({
    enabled,
    modulesLoading,
    permissionsLoading,
    hasWhatsAppModule: hasModule("whatsapp"),
    hasWhatsAppViewPermission: hasPermission("whatsapp_view") || hasPermission("whatsapp_operate"),
  });
}

export function useWhatsAppInboxRealtime(enabled: boolean = true, activeInbox: boolean = false) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const canSubscribe = useCanSubscribeWhatsAppRealtime(enabled);

  useEffect(() => {
    if (!canSubscribe || !scope.organizationId || !scope.userId) return;
    const organizationId = scope.organizationId;

    scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
      refreshConversations: true,
    });
    const supabase = createClient();
    const registry = getPrivateBroadcastRegistry(supabase, reportWhatsAppRealtimeDiagnostic);
    let cancelled = false;

    const reconcileInbox = () => {
      if (cancelled) return;
      scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
        refreshConversations: true,
        refreshMessages: true,
        refreshLeadMessages: true,
        allMessages: true,
        allLeadMessages: true,
      });
    };
    const catchUp = createWhatsAppInboxSubscriptionCatchUp(reconcileInbox);
    // The app shell may already own a subscribed physical channel. An active
    // inbox must reconcile on mount even if the registry sends no new status.
    if (activeInbox) catchUp.start(true);

    // The organization inbox channel is only a content-free wake-up signal.
    // Canonical data still comes from the scoped API.
    const lease = registry.acquire({
      topic: whatsappInboxTopic(organizationId),
      event: "whatsapp.inbox.changed",
      onPayload: (payload) => {
        if (!isWhatsAppInboxWakePayload(payload)) return;
        catchUp.hint();
      },
      onStatus: (status: PrivateBroadcastStatus) => {
        if (status !== "SUBSCRIBED") return;
        catchUp.start(activeInbox);
      },
    });

    return () => {
      cancelled = true;
      catchUp.dispose();
      lease.release();
    };
  }, [activeInbox, canSubscribe, scope, queryClient]);
}

export function useWhatsAppLeadRealtime(
  enabled: boolean = true,
  leadIds: string[] = [],
  options: { reconcileOnSubscribe?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const canSubscribe = useCanSubscribeWhatsAppRealtime(enabled);
  const leadKey = [...new Set(leadIds.filter(Boolean))].sort().join("|");
  const reconcileOnSubscribe = options.reconcileOnSubscribe ?? true;

  useEffect(() => {
    if (!canSubscribe || !scope.organizationId || !scope.userId || !leadKey) return;
    const organizationId = scope.organizationId;
    const scopedLeadIds = leadKey.split("|");
    const registry = getPrivateBroadcastRegistry(createClient(), reportWhatsAppRealtimeDiagnostic);
    const reconcileTimers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const leases = scopedLeadIds.map((leadId) => registry.acquire({
      topic: `whatsapp:${organizationId}:lead:${leadId}`,
      event: "whatsapp.message.changed",
      onPayload: (payload) => {
        const event = (payload || {}) as Record<string, unknown>;
        const conversationId = typeof event.conversationId === "string" ? event.conversationId : null;
        scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
          refreshConversations: true,
          refreshMessages: true,
          refreshLeadMessages: true,
          conversationIds: conversationId ? [conversationId] : undefined,
          leadIds: [leadId],
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("vimob:whatsapp-message-changed", {
            detail: { ...event, leadId, conversationId },
          }));
        }
      },
      onStatus: (status: PrivateBroadcastStatus) => {
        if (status !== "SUBSCRIBED" || !reconcileOnSubscribe) return;
        // Broadcast is a low-latency hint. Reconcile once immediately and once
        // after a cold subscription to close the commit-before-join window.
        const reconcile = () => {
          if (cancelled) return;
          scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
            refreshConversations: true,
            refreshMessages: true,
            refreshLeadMessages: true,
            leadIds: [leadId],
          });
        };
        reconcile();
        reconcileTimers.push(setTimeout(reconcile, 1_000));
      },
    }));

    const handleLeadChange = (browserEvent: Event) => {
      const change = (browserEvent as CustomEvent<{
        organizationId?: string; leadId?: string; reason?: string;
      }>).detail;
      if (cancelled || change?.organizationId !== organizationId
        || (change.leadId && !scopedLeadIds.includes(change.leadId))
        || !change.reason?.startsWith("lead.") || change.reason === "lead.whatsapp_activity") return;
      const changedLeadIds = change.leadId ? [change.leadId] : scopedLeadIds;
      // The lead bus carries IDs/reasons only. Refetch current authorization;
      // neither the event nor an older cached card grants conversation access.
      window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT, {
        detail: { scope, leadIds: changedLeadIds, authorizationChanged: true },
      }));
      // Authorization changes must supersede an older authorized list read;
      // ordinary content hints below can wait for the current read to finish.
      void queryClient.cancelQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      void queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.conversationsScope(scope), refetchType: "active",
      }, { cancelRefetch: true });
      scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
        refreshMessages: true,
        refreshLeadMessages: true,
        leadIds: changedLeadIds,
      });
      void queryClient.invalidateQueries({
        predicate: (query) => query.isActive() && isWhatsAppQueryKeyForScope(query.queryKey, scope)
          && ["whatsapp-conversation", "whatsapp-conversation-snapshot", "whatsapp-conversation-history"].includes(String(query.queryKey[0])),
        refetchType: "active",
      });
    };
    window.addEventListener("vimob:lead-realtime-change", handleLeadChange);

    return () => {
      cancelled = true;
      window.removeEventListener("vimob:lead-realtime-change", handleLeadChange);
      reconcileTimers.forEach((timer) => clearTimeout(timer));
      leases.forEach((lease) => lease.release());
    };
  }, [canSubscribe, leadKey, queryClient, reconcileOnSubscribe, scope]);
}
