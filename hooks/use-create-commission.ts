import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { financialAPI } from '@/lib/api/financial';

interface CreateCommissionParams {
  leadId: string;
  organizationId: string;
  userId: string | null;
  propertyId: string | null;
  valorInteresse: number | null;
  leadCommissionPercentage?: number | null;
}

interface CreateReceivableParams {
  leadId: string;
  organizationId: string;
  valorInteresse: number;
  description?: string;
  dueDays?: number;
}

type FinancialEntry = {
  id?: string;
  amount: number;
  due_date: string | null;
};

export function useCreateCommissionOnWon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ valorInteresse, leadCommissionPercentage }: CreateCommissionParams) => {
      const amount = valorInteresse ? (valorInteresse * (leadCommissionPercentage || 5)) / 100 : 0;
      return { commission: { amount }, percentage: leadCommissionPercentage || 5 };
    },
    onSuccess: (data) => {
      if (!data?.commission) return;

      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['top-brokers'] });
      queryClient.invalidateQueries({ queryKey: ['broker-performance'] });

      toast.success('Motor financeiro processado com sucesso!', {
        description: 'Contrato, parcelas e comissões gerados no backend.',
      });
    },
    onError: (error) => {
      console.error('Error creating commission:', error);
    },
  });
}

export function useCreateReceivableOnWon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, organizationId, valorInteresse, description, dueDays = 30 }: CreateReceivableParams) => {
      if (!valorInteresse || valorInteresse <= 0) {
        return null;
      }

      const existingEntries = await financialAPI.listEntries<Array<{ id: string }>>({
        lead_id: leadId,
        type: 'receivable',
      }, organizationId);

      if (existingEntries.length > 0) {
        return null;
      }

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + dueDays);

      return financialAPI.createEntry<FinancialEntry>({
        lead_id: leadId,
        type: 'receivable',
        amount: valorInteresse,
        status: 'pending',
        due_date: dueDate.toISOString().split('T')[0],
        description: description || 'Venda - negócio fechado',
        notes: 'Gerado automaticamente ao marcar lead como ganho',
      }, organizationId);
    },
    onSuccess: (data) => {
      if (!data) return;

      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      const dueDateLabel = data.due_date
        ? new Date(data.due_date).toLocaleDateString('pt-BR')
        : 'sem data definida';

      toast.success(
        `Conta a receber de R$ ${data.amount.toLocaleString('pt-BR', { minimumFractionDigits: 0 })} criada!`,
        { description: `Vencimento: ${dueDateLabel}` },
      );
    },
    onError: (error) => {
      console.error('Error creating receivable:', error);
    },
  });
}
