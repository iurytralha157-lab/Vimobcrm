import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { conversationLeadDetailAPI } from "@/lib/api/conversation-lead-detail";

export function useConversationLeadDetail(leadId: string | null | undefined) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useQuery({
    queryKey: ["conversation-lead-detail", organizationId, leadId],
    queryFn: async () => {
      if (!leadId) return null;
      return conversationLeadDetailAPI.get(leadId, organizationId);
    },
    enabled: !!leadId && !!organizationId,
    staleTime: 15_000,
  });
}
