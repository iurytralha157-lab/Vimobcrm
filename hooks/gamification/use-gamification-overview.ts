'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import {
  gamificationAPI,
  type GamificationEvent,
  type GamificationMission,
  type GamificationOverview,
  type GamificationRankingEntry,
} from '@/lib/api/gamification';

export type { GamificationEvent, GamificationMission, GamificationOverview, GamificationRankingEntry };

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
          missions: [],
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
