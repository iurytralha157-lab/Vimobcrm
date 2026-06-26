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

const LEAD_LIST_QUERY_KEYS = [
  "stages-with-leads",
  "leads",
  "contacts-list",
  "dashboard-stats",
  "enhanced-dashboard-stats",
  "leads-chart-data",
  "vgv-stats",
  "vgv-by-broker",
  "stage-vgv",
  "whatsapp-conversations",
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
  const { profile } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!profile?.organization_id) return;

    const orgId = profile.organization_id;

    const syncLeadCaches = (leadId?: string | null) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        LEAD_LIST_QUERY_KEYS.forEach((queryKey) => {
          void queryClient.invalidateQueries({
            queryKey: [queryKey],
            refetchType: "active",
          });
        });

        if (leadId) {
          LEAD_DETAIL_QUERY_KEYS.forEach((queryKey) => {
            void queryClient.invalidateQueries({
              queryKey: [queryKey, leadId],
              refetchType: "active",
            });
          });
        }

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
        if (change.organizationId && change.organizationId !== orgId) return;
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
          if (change?.organizationId && change.organizationId !== orgId) return;
          syncLeadCaches(change?.leadId);
        };
      }
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (typeof window !== "undefined") {
        window.removeEventListener(LEAD_REALTIME_BROWSER_EVENT, handleLocalLeadChange);
        window.removeEventListener("storage", handleStorageLeadChange);
      }

      browserChannel?.close();
    };
  }, [profile?.organization_id, queryClient]);

  return null;
}
