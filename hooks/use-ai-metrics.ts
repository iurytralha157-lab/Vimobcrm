import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { aiAPI } from "@/lib/api/ai";

export function useAIMetrics() {
  const { activeOrganization, organization, profile } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useQuery({
    queryKey: ["ai-metrics", organizationId],
    queryFn: () => aiAPI.metrics(organizationId),
    enabled: !!organizationId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
