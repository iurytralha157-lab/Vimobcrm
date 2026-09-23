"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  isWhatsAppOnlyLeadRealtimeBatch,
  shouldRefreshLeadMetaFilters,
} from "@/lib/lead-realtime-policy";
import { getPipelineRealtimeRefreshDelay } from "@/lib/pipeline-reliability";

type LeadRealtimeChange = {
  organizationId: string;
  leadId?: string | null;
  reason?: string;
  emittedAt?: number;
};

type LeadRealtimeBrowserEvent = CustomEvent<LeadRealtimeChange>;

const LEAD_REALTIME_BROWSER_EVENT = "vimob:lead-realtime-change";
const LEAD_REALTIME_BROWSER_CHANNEL = "vimob:lead-realtime";
const LEAD_REALTIME_STORAGE_KEY = "vimob:lead-realtime:last-change";
const LEAD_REALTIME_DEBOUNCE_MS = 150;
const LEAD_REALTIME_MAX_WAIT_MS = 1_000;
const OPTIMISTIC_PIPELINE_BOARD_WINDOW_MS = 4_000;
const optimisticPipelineBoardLeads = new Map<string, number>();

function optimisticPipelineBoardKey(organizationId: string, leadId: string) {
  return `${organizationId}:${leadId}`;
}

export function preserveOptimisticPipelineBoard(
  organizationId: string,
  leadId: string,
  durationMs = OPTIMISTIC_PIPELINE_BOARD_WINDOW_MS,
) {
  if (typeof window === "undefined" || !organizationId || !leadId) return;

  const key = optimisticPipelineBoardKey(organizationId, leadId);
  const expiresAt = Date.now() + durationMs;
  optimisticPipelineBoardLeads.set(key, expiresAt);

  window.setTimeout(() => {
    const currentExpiry = optimisticPipelineBoardLeads.get(key);
    if (currentExpiry && currentExpiry <= Date.now()) {
      optimisticPipelineBoardLeads.delete(key);
    }
  }, durationMs + 50);
}

function optimisticPipelineBoardRemainingMs(organizationId: string, leadIds: string[]) {
  const now = Date.now();
  let longestRemainingMs = 0;

  leadIds.forEach((leadId) => {
    const key = optimisticPipelineBoardKey(organizationId, leadId);
    const expiresAt = optimisticPipelineBoardLeads.get(key);
    if (!expiresAt) return;
    if (expiresAt <= now) {
      optimisticPipelineBoardLeads.delete(key);
      return;
    }

    longestRemainingMs = Math.max(longestRemainingMs, expiresAt - now);
  });

  return longestRemainingMs;
}

const LEAD_LIST_QUERY_KEYS = [
  "stages-with-leads",
  "filtered-stage-counts",
  "leads",
  "contacts-list",
  "dashboard-stats",
  "enhanced-dashboard-stats",
  "leads-chart-data",
  "funnel-data",
  "lead-sources-data",
  "deals-evolution",
  "dashboard-extra-counts",
  "dashboard-lead-distribution",
  "dashboard-first-contact",
  "dashboard-recent-activities",
  "recent-activities",
  "top-brokers",
  "upcoming-tasks",
  "dashboard-alerts",
  "lead-analytics",
  "campaign-insights",
  "gamification-overview",
  "vgv-stats",
  "vgv-by-broker",
  "stage-vgv",
] as const;

const WHATSAPP_LEAD_LIST_QUERY_KEYS = ["leads", "contacts-list"] as const;
const LEAD_META_FILTER_QUERY_KEYS = [
  "lead-meta-filters",
  "shared-filter-lead-meta-filters",
] as const;

const LEAD_DETAIL_QUERY_KEYS = [
  "lead",
  "lead-history-v2",
  "lead-timeline",
  "activities",
  "conversation-lead-detail",
] as const;

export function notifyLeadRealtimeChange(change: LeadRealtimeChange) {
  if (typeof window === "undefined") return;
  if (!change.organizationId) return;

  const payload: LeadRealtimeChange = {
    ...change,
    emittedAt: Date.now(),
  };

  window.dispatchEvent(
    new CustomEvent<LeadRealtimeChange>(LEAD_REALTIME_BROWSER_EVENT, {
      detail: payload,
    }),
  );

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(LEAD_REALTIME_BROWSER_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }

  try {
    window.localStorage.setItem(LEAD_REALTIME_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.removeItem(LEAD_REALTIME_STORAGE_KEY);
  } catch {
    // localStorage can be unavailable in private/restricted browser contexts.
  }
}

export function LeadRealtimeBus() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceStartedAtRef = useRef<number | null>(null);
  const pipelineReconcileRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineReconcileDueAtRef = useRef<number | null>(null);
  const pipelineReconcileStartedAtRef = useRef<number | null>(null);
  const lastPipelineRefreshAtRef = useRef<number | null>(null);
  const pendingWhatsAppBoardStaleRef = useRef(false);
  const pendingLeadIdsRef = useRef(new Set<string>());
  const pendingReasonsRef = useRef(new Set<string>());
  const hasUnscopedChangeRef = useRef(false);
  const organizationId = activeOrganization.organizationId;

  useEffect(() => {
    if (!organizationId) return;

    let isActive = true;
    const orgId = organizationId;
    const pendingLeadIds = pendingLeadIdsRef.current;
    const pendingReasons = pendingReasonsRef.current;
    const pipelineBoardQuery = { queryKey: ["stages-with-leads", orgId] };

    const markWhatsAppBoardStale = () => {
      void queryClient.invalidateQueries(
        {
          ...pipelineBoardQuery,
          refetchType: "none",
        },
        { cancelRefetch: false },
      );
    };

    const schedulePipelineBoardRefresh = (minimumDelayMs = 0) => {
      if (!isActive) return;

      const nowMs = Date.now();
      if (pipelineReconcileStartedAtRef.current === null) {
        pipelineReconcileStartedAtRef.current = nowMs;
      }
      const refreshDelayMs = getPipelineRealtimeRefreshDelay(
        nowMs,
        lastPipelineRefreshAtRef.current,
        minimumDelayMs,
        pipelineReconcileStartedAtRef.current,
      );
      const dueAtMs = nowMs + refreshDelayMs;

      // Keep an already scheduled later refresh: it can be protecting a local
      // optimistic move that has not reached the API read model yet.
      if (
        pipelineReconcileRef.current
        && pipelineReconcileDueAtRef.current !== null
        && pipelineReconcileDueAtRef.current >= dueAtMs
      ) {
        return;
      }

      if (pipelineReconcileRef.current) {
        clearTimeout(pipelineReconcileRef.current);
      }

      pipelineReconcileDueAtRef.current = dueAtMs;
      pipelineReconcileRef.current = setTimeout(() => {
        lastPipelineRefreshAtRef.current = Date.now();
        pipelineReconcileDueAtRef.current = null;
        pipelineReconcileStartedAtRef.current = null;
        pipelineReconcileRef.current = null;

        const wasAlreadyFetching = queryClient.isFetching(pipelineBoardQuery) > 0;
        const invalidation = queryClient.invalidateQueries(
          {
            ...pipelineBoardQuery,
            refetchType: "active",
          },
          { cancelRefetch: false },
        );

        // If the event arrived during an older read, run one trailing refresh
        // after it settles so that its earlier snapshot cannot win.
        if (wasAlreadyFetching) {
          void invalidation.finally(() => schedulePipelineBoardRefresh());
        }
      }, refreshDelayMs);
    };

    const syncLeadCaches = (change: LeadRealtimeChange) => {
      if (change.leadId) {
        pendingLeadIds.add(change.leadId);
      } else {
        hasUnscopedChangeRef.current = true;
      }
      if (change.reason?.trim()) pendingReasons.add(change.reason);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const nowMs = Date.now();
      if (debounceStartedAtRef.current === null) {
        debounceStartedAtRef.current = nowMs;
      }
      const elapsedMs = nowMs - debounceStartedAtRef.current;
      const debounceDelayMs = Math.min(
        LEAD_REALTIME_DEBOUNCE_MS,
        Math.max(0, LEAD_REALTIME_MAX_WAIT_MS - elapsedMs),
      );

      debounceRef.current = setTimeout(() => {
        const leadIdsToSync = [...pendingLeadIds];
        const reasonsToSync = [...pendingReasons];
        const hasUnscopedChange = hasUnscopedChangeRef.current;
        const isWhatsAppOnlyBatch = isWhatsAppOnlyLeadRealtimeBatch(reasonsToSync);
        pendingLeadIds.clear();
        pendingReasons.clear();
        hasUnscopedChangeRef.current = false;
        debounceStartedAtRef.current = null;
        if (isWhatsAppOnlyBatch) {
          // Message traffic has its own focused caches/realtime stream. Mark the
          // board stale for its next natural refresh without putting the heavy
          // board endpoint in a continuous refetch loop.
          if (queryClient.isFetching(pipelineBoardQuery) > 0) {
            pendingWhatsAppBoardStaleRef.current = true;
          } else {
            markWhatsAppBoardStale();
          }
        } else {
          const pipelineBoardRemainingMs = hasUnscopedChange
            ? 0
            : optimisticPipelineBoardRemainingMs(orgId, leadIdsToSync);
          schedulePipelineBoardRefresh(
            pipelineBoardRemainingMs > 0 ? pipelineBoardRemainingMs + 50 : 0,
          );
        }

        const listQueryKeys = isWhatsAppOnlyBatch
          ? WHATSAPP_LEAD_LIST_QUERY_KEYS
          : LEAD_LIST_QUERY_KEYS;

        listQueryKeys.forEach((queryKey) => {
          if (queryKey === "stages-with-leads") return;

          void queryClient.invalidateQueries(
            {
              queryKey: [queryKey],
              refetchType: "active",
            },
            { cancelRefetch: false },
          );
        });

        if (shouldRefreshLeadMetaFilters(reasonsToSync)) {
          LEAD_META_FILTER_QUERY_KEYS.forEach((queryKey) => {
            void queryClient.invalidateQueries(
              {
                queryKey: [queryKey, orgId],
                refetchType: "active",
              },
              { cancelRefetch: false },
            );
          });
        }

        leadIdsToSync.forEach((pendingLeadId) => {
          LEAD_DETAIL_QUERY_KEYS.forEach((queryKey) => {
            void queryClient.invalidateQueries(
              {
                queryKey: [queryKey],
                predicate: (query) => query.queryKey.includes(pendingLeadId),
                refetchType: "active",
              },
              { cancelRefetch: false },
            );
          });
        });

        debounceRef.current = null;
      }, debounceDelayMs);
    };

    const unsubscribeFromQueryCache = queryClient.getQueryCache().subscribe(() => {
      if (!pendingWhatsAppBoardStaleRef.current) return;
      if (queryClient.isFetching(pipelineBoardQuery) > 0) return;

      pendingWhatsAppBoardStaleRef.current = false;
      queueMicrotask(() => {
        if (isActive) markWhatsAppBoardStale();
      });
    });

    const handleLocalLeadChange = (event: Event) => {
      const change = (event as LeadRealtimeBrowserEvent).detail;
      if (!change?.organizationId || change.organizationId !== orgId) return;

      syncLeadCaches(change);
    };

    const handleStorageLeadChange = (event: StorageEvent) => {
      if (event.key !== LEAD_REALTIME_STORAGE_KEY || !event.newValue) return;
      try {
        const change = JSON.parse(event.newValue) as Partial<LeadRealtimeChange>;
        if (!change.organizationId || change.organizationId !== orgId) return;
        syncLeadCaches(change as LeadRealtimeChange);
      } catch {
        // Ignore malformed sync messages.
      }
    };

    let browserChannel: BroadcastChannel | null = null;
    if (typeof window !== "undefined") {
      window.addEventListener(LEAD_REALTIME_BROWSER_EVENT, handleLocalLeadChange);
      window.addEventListener("storage", handleStorageLeadChange);

      if ("BroadcastChannel" in window) {
        browserChannel = new BroadcastChannel(LEAD_REALTIME_BROWSER_CHANNEL);
        browserChannel.onmessage = (event: MessageEvent<Partial<LeadRealtimeChange>>) => {
          const change = event.data;
          if (!change?.organizationId || change.organizationId !== orgId) return;
          syncLeadCaches(change as LeadRealtimeChange);
        };
      }
    }

    return () => {
      isActive = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      debounceStartedAtRef.current = null;
      if (pipelineReconcileRef.current) {
        clearTimeout(pipelineReconcileRef.current);
        pipelineReconcileRef.current = null;
      }
      pipelineReconcileDueAtRef.current = null;
      pipelineReconcileStartedAtRef.current = null;
      lastPipelineRefreshAtRef.current = null;
      pendingWhatsAppBoardStaleRef.current = false;
      pendingLeadIds.clear();
      pendingReasons.clear();
      hasUnscopedChangeRef.current = false;

      if (typeof window !== "undefined") {
        window.removeEventListener(LEAD_REALTIME_BROWSER_EVENT, handleLocalLeadChange);
        window.removeEventListener("storage", handleStorageLeadChange);
      }

      browserChannel?.close();
      unsubscribeFromQueryCache();
    };
  }, [organizationId, queryClient]);

  return null;
}
