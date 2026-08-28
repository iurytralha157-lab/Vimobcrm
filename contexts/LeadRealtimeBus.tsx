"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

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
  "lead-meta-filters",
  "leads",
  "contacts-list",
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
  "campaign-insights",
  "gamification-overview",
  "vgv-stats",
  "vgv-by-broker",
  "stage-vgv",
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
  const { organization, profile } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineReconcileRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLeadIdsRef = useRef(new Set<string>());
  const hasUnscopedChangeRef = useRef(false);
  const organizationId = organization?.id || profile?.organization_id;

  useEffect(() => {
    if (!organizationId) return;

    const orgId = organizationId;
    const pendingLeadIds = pendingLeadIdsRef.current;

    const syncLeadCaches = (leadId?: string | null) => {
      if (leadId) {
        pendingLeadIds.add(leadId);
      } else {
        hasUnscopedChangeRef.current = true;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        const leadIdsToSync = [...pendingLeadIds];
        const hasUnscopedChange = hasUnscopedChangeRef.current;
        pendingLeadIds.clear();
        hasUnscopedChangeRef.current = false;
        const pipelineBoardRemainingMs = hasUnscopedChange
          ? 0
          : optimisticPipelineBoardRemainingMs(orgId, leadIdsToSync);
        const preservePipelineBoard = pipelineBoardRemainingMs > 0;

        if (preservePipelineBoard) {
          if (pipelineReconcileRef.current) {
            clearTimeout(pipelineReconcileRef.current);
          }
          pipelineReconcileRef.current = setTimeout(() => {
            void queryClient.invalidateQueries({
              queryKey: ["stages-with-leads"],
              refetchType: "active",
            });
            pipelineReconcileRef.current = null;
          }, pipelineBoardRemainingMs + 50);
        } else if (pipelineReconcileRef.current) {
          clearTimeout(pipelineReconcileRef.current);
          pipelineReconcileRef.current = null;
        }

        LEAD_LIST_QUERY_KEYS.forEach((queryKey) => {
          if (queryKey === "stages-with-leads" && preservePipelineBoard) return;

          void queryClient.invalidateQueries({
            queryKey: [queryKey],
            refetchType: "active",
          });
        });

        leadIdsToSync.forEach((pendingLeadId) => {
          LEAD_DETAIL_QUERY_KEYS.forEach((queryKey) => {
            void queryClient.invalidateQueries({
              queryKey: [queryKey],
              predicate: (query) => query.queryKey.includes(pendingLeadId),
              refetchType: "active",
            });
          });
        });

        debounceRef.current = null;
      }, 150);
    };

    const handleLocalLeadChange = (event: Event) => {
      const change = (event as LeadRealtimeBrowserEvent).detail;
      if (!change?.organizationId || change.organizationId !== orgId) return;

      syncLeadCaches(change.leadId);
    };

    const handleStorageLeadChange = (event: StorageEvent) => {
      if (event.key !== LEAD_REALTIME_STORAGE_KEY || !event.newValue) return;
      try {
        const change = JSON.parse(event.newValue) as Partial<LeadRealtimeChange>;
        if (!change.organizationId || change.organizationId !== orgId) return;
        syncLeadCaches(change.leadId);
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
          syncLeadCaches(change?.leadId);
        };
      }
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (pipelineReconcileRef.current) {
        clearTimeout(pipelineReconcileRef.current);
        pipelineReconcileRef.current = null;
      }
      pendingLeadIds.clear();
      hasUnscopedChangeRef.current = false;

      if (typeof window !== "undefined") {
        window.removeEventListener(LEAD_REALTIME_BROWSER_EVENT, handleLocalLeadChange);
        window.removeEventListener("storage", handleStorageLeadChange);
      }

      browserChannel?.close();
    };
  }, [organizationId, queryClient]);

  return null;
}
