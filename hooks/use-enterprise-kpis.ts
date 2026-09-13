import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { analyticsAPI } from "@/lib/api/analytics";

export type KPIData = {
  financial: {
    ebitda: number;
    revenue: number;
    expense: number;
    roi_overview: number;
  };
};

export function useEnterpriseKPIs(dateRange?: { from: Date; to: Date }) {
  const { activeOrganization, organization } = useAuth();

  return useQuery({
    queryKey: ["enterprise-kpis", activeOrganization.organizationId, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      if (!activeOrganization.organizationId) return null;
      return analyticsAPI.enterpriseKPIs<KPIData>({
        dateFrom: dateRange?.from?.toISOString(),
        dateTo: dateRange?.to?.toISOString(),
      });
    },
    enabled: !!activeOrganization.organizationId,
  });
}
