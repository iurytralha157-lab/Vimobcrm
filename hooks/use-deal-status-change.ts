import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { leadsAPI } from '@/lib/api/leads';
import { useCreateCommissionOnWon, useCreateReceivableOnWon } from './use-create-commission';
import { notifyLeadWon } from './use-lead-notifications';

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
  const createCommission = useCreateCommissionOnWon();
  const createReceivable = useCreateReceivableOnWon();

  return useMutation({
    mutationFn: async (params: ChangeDealStatusParams) => {
      const { leadId, newStatus, lostReason } = params;

      const updateData: TablesUpdate<'leads'> = {
        deal_status: newStatus,
        lost_reason: newStatus === 'lost' ? lostReason || '' : null,
      };

      const { data: lead, error } = await leadsAPI.updateLead(leadId, updateData, params.organizationId);

      if (error) throw error;
      if (!lead) throw new Error('API nao retornou o lead atualizado');

      return { lead, newStatus };
    },
    onSuccess: async ({ newStatus }, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-dashboard-stats'] });

      if (newStatus === 'won') {
        if (variables.valorInteresse && variables.valorInteresse > 0) {
          try {
            await createCommission.mutateAsync({
              leadId: variables.leadId,
              organizationId: variables.organizationId,
              userId: variables.userId,
              propertyId: variables.propertyId,
              valorInteresse: variables.valorInteresse,
              leadCommissionPercentage: variables.commissionPercentage,
            });
          } catch (err) {
            console.error('Failed to create commission:', err);
          }

          try {
            await createReceivable.mutateAsync({
              leadId: variables.leadId,
              organizationId: variables.organizationId,
              valorInteresse: variables.valorInteresse,
              description: `Venda - ${variables.leadName}`,
            });
          } catch (err) {
            console.error('Failed to create receivable:', err);
          }
        } else {
          toast.warning('Lead marcado como ganho sem valor de interesse', {
            description: 'Preencha o valor para gerar comissao e conta a receber',
          });
        }

        toast.success('Negocio fechado!', {
          description: variables.valorInteresse
            ? `R$ ${variables.valorInteresse.toLocaleString('pt-BR')}`
            : undefined,
        });

        if (variables.userId) {
          try {
            await notifyLeadWon({
              leadId: variables.leadId,
              leadName: variables.leadName,
              organizationId: variables.organizationId,
              organizationName: variables.organizationName || 'Organizacao',
              assignedUserId: variables.userId,
            });
          } catch (err) {
            console.error('Lead won notification failed:', err);
          }
        }
      } else if (newStatus === 'lost') {
        toast.info('Lead marcado como perdido');
      } else {
        toast.info('Lead reaberto');
      }
    },
    onError: (error) => {
      console.error('Error changing deal status:', error);
      toast.error('Erro ao alterar status do negocio');
    },
  });
}
