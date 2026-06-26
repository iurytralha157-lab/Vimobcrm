import { useQuery } from '@tanstack/react-query';
import { analyticsAPI } from '@/lib/api/analytics';

export interface LeaderStats {
  userId: string;
  userName: string;
  teamId: string;
  teamName: string;
  totalLeads: number;
  convertedLeads: number;
  conversionRate: number;
  avgTimeInStage: number | null;
}

export function useLeaderStats() {
  return useQuery({
    queryKey: ['leader-stats'],
    queryFn: () => analyticsAPI.leaderStats<LeaderStats>(),
  });
}

export function useTeamLeaderStats(teamId: string) {
  return useQuery({
    queryKey: ['team-leader-stats', teamId],
    queryFn: () => analyticsAPI.teamLeaderStats(teamId),
    enabled: !!teamId,
  });
}
