import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { leadsAPI } from '@/lib/api/leads';
import { lostReasonSchema } from '@/lib/validation';

interface ChangeDealStatusParams {
  leadId: string;
  newStatus: 'open' | 'won' | 'lost';
  organizationId: string;
  organizationName?: string | null;
  userId: string | null;
  propertyId: string | null;
  valorInteresse: number | null;
  commissionPercentage: number | null;
  leadName: string;
  lostReason?: string | null;
}

export function useDealStatusChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ChangeDealStatusParams) => {
      const { leadId, newStatus, lostReason } = params;
      const validatedLostReason = newStatus === 'lost'
        ? lostReasonSchema.parse(lostReason || '')
        : null;

      const updateData: TablesUpdate<'leads'> = {
        deal_status: newStatus,
        lost_reason: validatedLostReason,
      };
      if (params.propertyId) {
        updateData.property_id = params.propertyId;
        updateData.interest_property_id = params.propertyId;
      }

      const { data: lead, error } = await leadsAPI.updateLead(leadId, updateData, params.organizationId);

      if (error) throw error;
      if (!lead) throw new Error('API nao retornou o lead atualizado');

      return { lead, newStatus };
    },
    onSuccess: ({ newStatus }, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-dashboard-stats'] });

      if (newStatus === 'won') {
        queryClient.invalidateQueries({ queryKey: ['properties'] });
        queryClient.invalidateQueries({ queryKey: ['properties-infinite'] });
        queryClient.invalidateQueries({ queryKey: ['property'] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
        if (variables.propertyId) {
          queryClient.invalidateQueries({ queryKey: ['property', variables.organizationId, variables.propertyId] });
        }

        if (!variables.valorInteresse || variables.valorInteresse <= 0) {
          toast.warning('Lead marcado como ganho sem valor de interesse', {
            description: 'Preencha o valor para gerar comissao e conta a receber',
          });
        }

        toast.success('Negocio fechado!', {
          description: variables.valorInteresse
            ? `R$ ${variables.valorInteresse.toLocaleString('pt-BR')}`
            : undefined,
        });

      } else if (newStatus === 'lost') {
        toast.info('Lead marcado como perdido');
      } else {
        toast.info('Lead reaberto');
      }
    },
    onError: (error) => {
      console.error('Error changing deal status:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao alterar status do negocio');
    },
  });
}
