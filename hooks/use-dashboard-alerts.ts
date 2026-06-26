import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { financialAPI } from "@/lib/api/financial";
import { startOfDay } from "date-fns";

export function useDashboardAlerts() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ["dashboard-alerts", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return { finance: [], total: 0 };

      const now = startOfDay(new Date());

      const finance = await financialAPI.listEntries<Record<string, unknown>[]>({
        status: "pending",
        endDate: now.toISOString().split("T")[0],
      }, organization.id);

      return {
        finance: finance || [],
        total: finance?.length || 0
      };
    },
    enabled: !!organization?.id,
    refetchInterval: 1000 * 60 * 5, // 5 minutes
  });
}
