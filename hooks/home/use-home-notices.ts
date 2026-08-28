"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { homeAPI } from "@/lib/api";

const HOME_NOTICES_STALE_TIME_MS = 60_000;
const HOME_NOTICES_GC_TIME_MS = 10 * 60_000;

export function useHomeNotices() {
  const { organization, profile, user } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: ["home", "notices", organizationId, user?.id],
    enabled: Boolean(organizationId && user?.id),
    queryFn: ({ signal }) => homeAPI.listNotices(organizationId, signal),
    staleTime: HOME_NOTICES_STALE_TIME_MS,
    gcTime: HOME_NOTICES_GC_TIME_MS,
    refetchInterval: HOME_NOTICES_STALE_TIME_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
