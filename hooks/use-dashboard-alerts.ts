import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { financialAPI } from "@/lib/api/financial";
import { startOfDay } from "date-fns";

export function useDashboardAlerts() {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: ["dashboard-alerts", organizationId],
    queryFn: async () => {
      if (!organizationId) return { finance: [], total: 0 };

      const now = startOfDay(new Date());

      const finance = await financialAPI.listEntries<Record<string, unknown>[]>({
        status: "pending",
        endDate: now.toISOString().split("T")[0],
      }, organizationId);

      return {
        finance: finance || [],
        total: finance?.length || 0
      };
    },
    enabled: !!organizationId,
    refetchInterval: 1000 * 60 * 5, // 5 minutes
  });
}
