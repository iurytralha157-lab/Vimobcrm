import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';

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
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation({
    mutationFn: async (leadId: string): Promise<AssignLeadResult> => {
      if (!organizationId) {
        throw new Error('Usuário não possui organização');
      }

      return leadsAPI.redistributeLeadRoundRobin(leadId, organizationId, { expectedUnassigned: true });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (organizationId && data.success && data.assigned_user_id) {
        notifyLeadRealtimeChange({
          organizationId,
          leadId: data.lead_id,
          reason: 'lead.redistributed',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      queryClient.invalidateQueries({ queryKey: ['lead', data.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', data.lead_id] });

      if (data.error === 'already_assigned') {
        toast.info('Este lead já possui responsável. O card foi atualizado.');
      } else if (data.success && data.assigned_user_id) {
        toast.success('Lead atribuído pela fila de distribuição.');
      } else if (data.error === 'no_available_members' || data.error === 'no_member') {
        toast.warning('A fila deste lead não encontrou responsável disponível.');
      } else if (data.error === 'no_matching_queue' || data.error === 'no_queue') {
        toast.warning('A fila de origem deste lead não está disponível para distribuição.');
      } else {
        toast.error('Não foi possível atribuir o lead pela fila de origem.');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
