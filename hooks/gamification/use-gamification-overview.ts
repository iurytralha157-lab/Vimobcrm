'use client';

import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import {
  gamificationAPI,
  type GamificationActionType,
  type GamificationAdminSnapshot,
  type GamificationEvent,
  type GamificationEventListQuery,
  type GamificationMission,
  type GamificationOverview,
  type GamificationParticipant,
  type GamificationPerformance,
  type GamificationRankingEntry,
  type GamificationRankingQuery,
  type GamificationRule,
  type GamificationSeason,
  type GamificationManualEntry,
} from '@/lib/api/gamification';
import { createClient } from '@/lib/supabase/client';

export type {
  GamificationActionType,
  GamificationAdminSnapshot,
  GamificationEvent,
  GamificationEventListQuery,
  GamificationManualEntry,
  GamificationMission,
  GamificationOverview,
  GamificationParticipant,
  GamificationPerformance,
  GamificationRankingEntry,
  GamificationRankingQuery,
  GamificationRule,
  GamificationSeason,
};

export function useGamificationEvents(filters: Omit<GamificationEventListQuery, 'cursor'>, enabled = true) {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const query = useInfiniteQuery({
    queryKey: [
      'gamification-events',
      organizationId,
      filters.from ?? null,
      filters.to ?? null,
      filters.userId ?? null,
      filters.limit ?? 50,
    ],
    queryFn: ({ pageParam }) => gamificationAPI.getEvents({
      ...filters,
      cursor: typeof pageParam === 'string' ? pageParam : undefined,
    }, organizationId),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    maxPages: 5,
    enabled: enabled && !!organizationId,
    staleTime: 30_000,
    refetchInterval: 1000 * 60 * 5,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const events = useMemo(() => query.data?.pages.flatMap((page) => page.events) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  return { ...query, events, total };
}

export function useGamificationRanking(filters: GamificationRankingQuery, enabled = true) {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  const query = useQuery({
    queryKey: [
      'gamification-ranking',
      organizationId,
      filters.from ?? null,
      filters.to ?? null,
      ...(filters.actionTypes ?? []),
    ],
    queryFn: () => gamificationAPI.getRanking(filters, organizationId),
    enabled: enabled && !!organizationId,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    refetchInterval: 1000 * 60 * 5,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return useMemo(() => ({ ...query, ranking: query.data }), [query]);
}

export function useGamificationRealtime(enabled = true) {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !organizationId) return;

    const supabase = createClient();
    let coreTimer: ReturnType<typeof setTimeout> | null = null;
    let adminTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidateCore = () => {
      if (coreTimer) return;
      coreTimer = setTimeout(() => {
        coreTimer = null;
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['gamification-overview', organizationId] }),
          queryClient.invalidateQueries({ queryKey: ['gamification-ranking', organizationId] }),
          queryClient.invalidateQueries({ queryKey: ['gamification-events', organizationId] }),
        ]);
      }, 1_500);
    };
    const invalidateAdmin = () => {
      if (adminTimer) return;
      adminTimer = setTimeout(() => {
        adminTimer = null;
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['gamification-admin', organizationId] }),
          queryClient.invalidateQueries({ queryKey: ['gamification-overview', organizationId] }),
        ]);
      }, 1_500);
    };
    const invalidateAll = () => {
      invalidateCore();
      invalidateAdmin();
    };

    const channel = supabase
      .channel(`gamification-live:${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gamification_events', filter: `organization_id=eq.${organizationId}` }, invalidateCore)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_gamification_stats', filter: `organization_id=eq.${organizationId}` }, invalidateCore)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gamification_seasons', filter: `organization_id=eq.${organizationId}` }, invalidateAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gamification_participants', filter: `organization_id=eq.${organizationId}` }, invalidateAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gamification_missions', filter: `organization_id=eq.${organizationId}` }, invalidateAdmin)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gamification_manual_entries', filter: `organization_id=eq.${organizationId}` }, invalidateAdmin)
      .subscribe((status) => setIsConnected(status === 'SUBSCRIBED'));

    return () => {
      if (coreTimer) clearTimeout(coreTimer);
      if (adminTimer) clearTimeout(adminTimer);
      setIsConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [enabled, organizationId, queryClient]);

  return isConnected;
}

export function useGamificationOverview(enabled = true) {
  const { organization } = useAuth();
  const organizationId = organization?.id;

  const query = useQuery({
    queryKey: ['gamification-overview', organizationId],
    queryFn: async (): Promise<GamificationOverview> => {
      if (!organizationId) {
        return {
          ranking: [],
          recentEvents: [],
          history: [],
          missions: [],
          performance: {
            chartData: [],
            metrics: {
              points: 0,
              growth: 0,
              avgActionsPerDay: 0,
              totalActions: 0,
              efficiency: 0,
              consistency: 0,
            },
            distribution: [],
          },
          totalPoints: 0,
          activeUsers: 0,
          totalEvents: 0,
          myPosition: null,
        };
      }

      return gamificationAPI.getOverview(organizationId);
    },
    enabled: enabled && !!organizationId,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 5,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return useMemo(() => ({ ...query, overview: query.data }), [query]);
}
