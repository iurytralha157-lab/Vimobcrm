'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import {
  gamificationAPI,
  type GamificationAdminSnapshot,
  type GamificationEvent,
  type GamificationMission,
  type GamificationOverview,
  type GamificationParticipant,
  type GamificationPerformance,
  type GamificationRankingEntry,
  type GamificationRule,
  type GamificationSeason,
  type GamificationManualEntry,
} from '@/lib/api/gamification';
import { createClient } from '@/lib/supabase/client';

export type {
  GamificationAdminSnapshot,
  GamificationEvent,
  GamificationManualEntry,
  GamificationMission,
  GamificationOverview,
  GamificationParticipant,
  GamificationPerformance,
  GamificationRankingEntry,
  GamificationRule,
  GamificationSeason,
};

export function useGamificationOverview() {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

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
    enabled: !!organizationId,
    staleTime: 1000 * 3,
    refetchInterval: 1000 * 5,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!organizationId) return;

    const supabase = createClient();
    const invalidateOverview = () => {
      void queryClient.invalidateQueries({ queryKey: ['gamification-overview', organizationId] });
    };

    const channel = supabase
      .channel(`gamification-live:${organizationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gamification_events', filter: `organization_id=eq.${organizationId}` },
        invalidateOverview,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gamification_activity_logs', filter: `organization_id=eq.${organizationId}` },
        invalidateOverview,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_gamification_stats', filter: `organization_id=eq.${organizationId}` },
        invalidateOverview,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gamification_participants', filter: `organization_id=eq.${organizationId}` },
        invalidateOverview,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);

  return useMemo(
    () => ({
      ...query,
      overview: query.data,
    }),
    [query],
  );
}
