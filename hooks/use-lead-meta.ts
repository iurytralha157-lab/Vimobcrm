import { useQuery } from "@tanstack/react-query";
import { leadMetaAPI, type LeadMeta } from "@/lib/api/lead-meta";

export type { LeadMeta } from "@/lib/api/lead-meta";

export function useLeadMeta(leadId: string | null) {
  return useQuery({
    queryKey: ['lead-meta', leadId],
    enabled: !!leadId,
    queryFn: async () => {
      if (!leadId) return null;
      return leadMetaAPI.get(leadId) as Promise<LeadMeta | null>;
    }
  });
}
