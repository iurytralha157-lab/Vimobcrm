import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface AssignLeadResult {
  success: boolean;
  lead_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  assigned_user_id: string | null;
  round_robin_used: boolean;
  error?: string;
}

export function useAssignLeadRoundRobin() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useMutation({
    mutationFn: async (leadId: string): Promise<AssignLeadResult> => {
      if (!organizationId) {
        throw new Error('Usuario nao possui organizacao');
      }

      return leadsAPI.redistributeLeadRoundRobin(leadId, organizationId);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      queryClient.invalidateQueries({ queryKey: ['lead', data.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', data.lead_id] });

      if (data.assigned_user_id) {
        toast.success('Lead atribuido com sucesso via round-robin!');
      } else if (data.round_robin_used === false) {
        toast.warning('Nenhum round-robin ativo encontrado. Configure um round-robin primeiro.');
      } else {
        toast.info('Lead processado, mas nao foi possivel atribuir automaticamente.');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
