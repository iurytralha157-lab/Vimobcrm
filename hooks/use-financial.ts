import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { financialAPI } from "@/lib/api/financial";
import { useToast } from "@/hooks/use-toast";

export interface FinancialCategory {
  id: string;
  organization_id: string;
  name: string;
  type: 'income' | 'expense';
  created_at: string;
  category_group?: string;
}

export interface FinancialEntry {
  id: string;
  organization_id: string;
  type: 'payable' | 'receivable';
  category?: string;
  category_group?: string;
  contract_id?: string;
  lead_id?: string;
  broker_id?: string;
  description?: string;
  amount: number;
  due_date?: string;
  paid_date?: string;
  payment_method?: string;
  status?: string;
  notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  contract?: { contract_number?: string };
  installment_number?: number;
  total_installments?: number;
  is_recurring?: boolean;
  recurring_type?: 'monthly' | 'weekly' | 'yearly';
  parent_entry_id?: string;
}

export type FinancialEntryMutationInput = Partial<Omit<
  FinancialEntry,
  | 'category'
  | 'category_group'
  | 'contract_id'
  | 'lead_id'
  | 'broker_id'
  | 'description'
  | 'due_date'
  | 'paid_date'
  | 'payment_method'
  | 'status'
  | 'notes'
  | 'installment_number'
  | 'total_installments'
  | 'is_recurring'
  | 'recurring_type'
  | 'parent_entry_id'
>> & {
  category?: string | null;
  category_group?: string | null;
  contract_id?: string | null;
  lead_id?: string | null;
  broker_id?: string | null;
  description?: string | null;
  due_date?: string | null;
  paid_date?: string | null;
  payment_method?: string | null;
  status?: string | null;
  notes?: string | null;
  installment_number?: number | null;
  total_installments?: number | null;
  is_recurring?: boolean | null;
  recurring_type?: 'monthly' | 'weekly' | 'yearly' | null;
  parent_entry_id?: string | null;
};

export interface FinancialDashboardData {
  receivable30: number;
  receivable60: number;
  receivable90: number;
  confirmedRevenue30: number;
  confirmedRevenueYTD: number;
  totalPayable: number;
  forecastCommissions: number;
  paidCommissions: number;
  pendingCommissions: number;
  overdueReceivables: number;
  overduePayables: number;
  monthlyData: { month: string; receitas: number; despesas: number }[];
  totalLeadsValue: number;
  vgvBruto: number;
  vgvLiquido: number;
  totalContractsValue: number;
  activeContracts: number;
  wonLeadsCount: number;
  avgTicket: number;
  conversionRate: number;
  annualProjection: number;
  defaultRate: number;
}

export function useFinancialCategories() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['financial-categories', organizationId],
    queryFn: () => financialAPI.listCategories<FinancialCategory[]>(organizationId),
    enabled: !!organizationId,
  });
}

export function useCreateFinancialCategory() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: { name: string; type: 'income' | 'expense' }) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.createCategory<FinancialCategory>(data, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financial-categories'] });
      toast({ title: "Categoria criada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar categoria", description: error.message, variant: "destructive" });
    },
  });
}

export function useFinancialEntries(filters?: { type?: string; status?: string; startDate?: string; endDate?: string }) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['financial-entries', organizationId, filters],
    queryFn: () => financialAPI.listEntries<FinancialEntry[]>(filters, organizationId),
    enabled: !!organizationId,
  });
}

export function useCreateFinancialEntry() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: FinancialEntryMutationInput) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.createEntry<FinancialEntry>(data, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Lancamento criado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar lancamento", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateFinancialEntry() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, ...data }: FinancialEntryMutationInput & { id: string }) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.updateEntry<FinancialEntry>(id, data, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Lancamento atualizado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar lancamento", description: error.message, variant: "destructive" });
    },
  });
}

export function useMarkEntryAsPaid() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, paid_value }: { id: string; paid_value?: number }) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.markEntryPaid<FinancialEntry>(id, { paid_value }, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Pagamento registrado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao registrar pagamento", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteFinancialEntry() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.deleteEntry(id, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Lancamento excluido com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir lancamento", description: error.message, variant: "destructive" });
    },
  });
}

export function useFinancialDashboard() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['financial-dashboard', organizationId],
    queryFn: () => financialAPI.dashboard<FinancialDashboardData>(organizationId),
    enabled: !!organizationId,
  });
}
