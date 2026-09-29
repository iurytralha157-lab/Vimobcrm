import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { leadMetaAPI, type LeadMeta } from "@/lib/api/lead-meta";

export type { LeadMeta } from "@/lib/api/lead-meta";

export function useLeadMeta(leadId: string | null) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useQuery({
    queryKey: ['lead-meta', leadId],
    enabled: !!leadId && !!organizationId,
    queryFn: async () => {
      if (!leadId || !organizationId) return null;
      return leadMetaAPI.get(leadId, organizationId) as Promise<LeadMeta | null>;
    }
  });
}
