import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { whatsappAPI, type WhatsAppMessage } from '@/lib/api/whatsapp';

export interface LeadMessage extends WhatsAppMessage {
  session_owner_name?: string | null;
  session_instance_name?: string | null;
}

export function useLeadMessages(leadId: string | null | undefined) {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  return useQuery({
    queryKey: ['lead-messages', organizationId, leadId],
    queryFn: async (): Promise<LeadMessage[]> => {
      if (!leadId || !organizationId) return [];

      const history = await whatsappAPI.getHistoryAccess({
        leadId,
        allMessages: true,
        organizationId,
      });

      return history.messages as LeadMessage[];
    },
    enabled: !!leadId && !!organizationId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
