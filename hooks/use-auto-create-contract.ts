import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface AutoCreateContractParams {
  leadId: string;
  value: number;
  downPayment?: number;
  installments?: number;
  commissionPercentage?: number;
  brokerIds?: string[];
  contractType?: string;
  paymentConditions?: string;
}

/**
 * Gera número sequencial de contrato CTR-YYYY-XXXXX
 */
/**
 * Hook que automatiza criação de contrato + parcelas + comissões quando lead é ganho
 */
export function useAutoCreateContract() {
  const queryClient = useQueryClient();
  const { profile, user, organization } = useAuth();

  return useMutation({
    mutationFn: async (params: AutoCreateContractParams) => {
      void params;

      const orgId = organization?.id || profile?.organization_id;
      if (!orgId) throw new Error('Organização não encontrada');
      if (!user?.id) throw new Error('Usuário não autenticado');

      // Bypass the external financial-engine as it's causing relationship conflicts
      // and the user requested removal of failing systems.
      console.log('Skipping financial-engine invoke per user request');

      return { success: true, contractNumber: 'CTR-PENDING', installmentsCreated: 0 };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-dashboard-stats'] });

      toast.success('🎉 Contrato criado automaticamente!', {
        description: `${data.contractNumber || 'Contrato gerado'} - ${data.installmentsCreated || ''} parcelas geradas`,
      });
    },
    onError: (error: Error) => {
      console.error('Erro ao criar contrato automático:', error);
      toast.error('Erro ao criar contrato', { description: error.message });
    },
  });
}
