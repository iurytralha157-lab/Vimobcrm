import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { financialAPI } from '@/lib/api/financial';
import { toast } from 'sonner';

export interface SmartInstallment {
  id: string;
  label: string; // "1/10", "2/10"
  installmentNumber: number;
  totalInstallments: number;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: string;
  status: string;
  isLate: boolean;
  lateDays: number;
  lateFee: number | null; // multa por atraso
  canEdit: boolean;
  contractId: string;
}

type FinancialInstallmentEntry = {
  id: string;
  amount: number;
  paid_amount?: number | null;
  paid_value?: number | null;
  installment_number?: number | null;
  total_installments?: number | null;
  due_date?: string | null;
  status?: string | null;
  contract_id?: string | null;
};

const LATE_FEE_PERCENTAGE = 0.02; // 2%
const DAILY_INTEREST_RATE = 0.00033; // 0.033% ao dia

function calculateLateFee(amount: number, daysLate: number): number {
  if (daysLate <= 0) return 0;
  const penalty = amount * LATE_FEE_PERCENTAGE;
  const interest = amount * DAILY_INTEREST_RATE * daysLate;
  return Math.round((penalty + interest) * 100) / 100;
}

function getDaysLate(dueDate: string): number {
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = today.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}

/**
 * Hook que lista parcelas de um contrato com status enriquecido
 */
export function useSmartInstallments(contractId: string | undefined) {
  return useQuery({
    queryKey: ['smart-installments', contractId],
    queryFn: async () => {
      if (!contractId) return [];
      const activeContractId = contractId;

      const entries = (await financialAPI.listEntries<FinancialInstallmentEntry[]>({
        contract_id: contractId,
        type: 'receivable',
      })).filter((entry) => Number(entry.installment_number || 0) > 0)
        .sort((a, b) => Number(a.installment_number || 0) - Number(b.installment_number || 0));

      return entries.map((entry): SmartInstallment => {
        const paidAmount = entry.paid_amount || entry.paid_value || 0;
        const remainingAmount = Math.max(0, entry.amount - paidAmount);
        const dueDate = entry.due_date || '';
        const installmentNumber = entry.installment_number || 0;
        const totalInstallments = entry.total_installments || entries.length;
        const daysLate = dueDate && entry.status !== 'paid' ? getDaysLate(dueDate) : 0;
        const isLate = daysLate > 0 && entry.status !== 'paid';
        const lateFee = isLate ? calculateLateFee(entry.amount, daysLate) : null;

        return {
          id: entry.id,
          label: `${installmentNumber}/${totalInstallments}`,
          installmentNumber,
          totalInstallments,
          amount: entry.amount,
          paidAmount,
          remainingAmount,
          dueDate,
          status: entry.status || 'pending',
          isLate,
          lateDays: daysLate,
          lateFee,
          canEdit: entry.status !== 'paid',
          contractId: entry.contract_id || activeContractId,
        };
      });
    },
    enabled: !!contractId,
  });
}

/**
 * Hook para pagar parcela (total ou parcial)
 */
export function usePayInstallment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ installmentId, amount }: { installmentId: string; amount: number }) => {
      // Buscar parcela atual
      const [entry] = await financialAPI.listEntries<FinancialInstallmentEntry[]>({ id: installmentId });
      if (!entry) throw new Error('Parcela nao encontrada');

      const currentPaid = entry.paid_amount || entry.paid_value || 0;
      const newPaidAmount = currentPaid + amount;
      const totalAmount = entry.amount;

      // Determinar novo status
      let newStatus = 'partial';
      let paidDate: string | null = null;

      if (newPaidAmount >= totalAmount) {
        newStatus = 'paid';
        paidDate = new Date().toISOString().split('T')[0];
      }

      await financialAPI.updateEntry(installmentId, {
        paid_amount: newPaidAmount,
        paid_value: newPaidAmount,
        status: newStatus,
        paid_date: paidDate || undefined,
      });

      return { newPaidAmount, newStatus };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['smart-installments'] });
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });

      if (data.newStatus === 'paid') {
        toast.success('Parcela paga integralmente!');
      } else {
        toast.success(`Pagamento parcial registrado - R$ ${data.newPaidAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      }
    },
    onError: (error: Error) => {
      toast.error('Erro ao registrar pagamento', { description: error.message });
    },
  });
}

/**
 * Calcula tabela Price para parcelas
 */
export function calculatePriceTable(
  totalValue: number,
  downPayment: number,
  installments: number,
  monthlyInterestRate: number = 0
): { installmentValue: number; totalWithInterest: number } {
  const principal = totalValue - downPayment;

  if (monthlyInterestRate <= 0 || installments <= 0) {
    return {
      installmentValue: Math.round((principal / Math.max(installments, 1)) * 100) / 100,
      totalWithInterest: principal,
    };
  }

  // Sistema Price: PMT = PV * [i(1+i)^n] / [(1+i)^n - 1]
  const i = monthlyInterestRate / 100;
  const n = installments;
  const factor = (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
  const installmentValue = Math.round(principal * factor * 100) / 100;

  return {
    installmentValue,
    totalWithInterest: Math.round(installmentValue * installments * 100) / 100,
  };
}
