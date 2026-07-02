'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

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
    staleTime: 1000 * 60 * 2,
  });

  return useMemo(
    () => ({
      ...query,
      overview: query.data,
    }),
    [query],
  );
}
