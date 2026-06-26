import { useQuery } from "@tanstack/react-query";
import { endOfMonth, startOfMonth } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { analyticsAPI } from "@/lib/api/analytics";

export interface TeamRankingEntry {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  closedCount: number;
  position: number;
  isCurrentUser: boolean;
}

export interface TeamRankingData {
  ranking: TeamRankingEntry[];
  myPosition: number | null;
}

export function useTeamRanking(dateRange?: { from: Date; to: Date }) {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const organizationId = profile?.organization_id;

  return useQuery({
    queryKey: ["team-ranking", organizationId, userId, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async (): Promise<TeamRankingData> => {
      if (!organizationId || !userId) {
        return { ranking: [], myPosition: null };
      }

      const now = new Date();
      const monthStart = dateRange ? dateRange.from.toISOString() : startOfMonth(now).toISOString();
      const monthEnd = dateRange ? dateRange.to.toISOString() : endOfMonth(now).toISOString();

      return analyticsAPI.teamRanking<TeamRankingData>({
        dateFrom: monthStart,
        dateTo: monthEnd,
      });
    },
    enabled: !!organizationId && !!userId,
    staleTime: 1000 * 60 * 5,
  });
}
