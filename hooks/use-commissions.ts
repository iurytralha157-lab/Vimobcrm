import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { financialAPI } from "@/lib/api/financial";
import { useToast } from "@/hooks/use-toast";

export interface CommissionRule {
  id: string;
  organization_id: string;
  name: string;
  business_type: 'sale' | 'rental' | 'service' | 'all';
  commission_type: 'percentage' | 'fixed';
  commission_value: number;
  is_active: boolean;
  created_at: string;
}

export interface Commission {
  id: string;
  organization_id: string;
  contract_id?: string;
  user_id: string;
  property_id?: string;
  rule_id?: string;
  amount?: number;
  base_value: number;
  percentage?: number;
  calculated_value: number;
  status: 'forecast' | 'pending' | 'approved' | 'paid' | 'cancelled';
  forecast_date?: string;
  approved_at?: string;
  approved_by?: string;
  paid_at?: string;
  paid_by?: string;
  payment_proof?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  user?: { id: string; name: string; email: string };
  contract?: { contract_number: string; client_name: string };
  property?: { code: string; title: string };
}

export function useCommissionRules() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['commission-rules', organizationId],
    queryFn: () => financialAPI.listCommissionRules<CommissionRule[]>(organizationId),
    enabled: !!organizationId,
  });
}

export function useCreateCommissionRule() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: Partial<CommissionRule>) => {
      const organizationId = organization?.id || profile?.organization_id;
      if (!organizationId) throw new Error("Organizacao nao encontrada");
      return financialAPI.createCommissionRule<CommissionRule>(data, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
      toast({ title: "Regra de comissao criada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar regra", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateCommissionRule() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, ...data }: Partial<CommissionRule> & { id: string }) => {
      const organizationId = organization?.id || profile?.organization_id;
      return financialAPI.updateCommissionRule<CommissionRule>(id, data, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
      toast({ title: "Regra atualizada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar regra", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteCommissionRule() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => {
      const organizationId = organization?.id || profile?.organization_id;
      return financialAPI.deleteCommissionRule(id, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
      toast({ title: "Regra excluida com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir regra", description: error.message, variant: "destructive" });
    },
  });
}

export function useCommissions(filters?: { status?: string; userId?: string }) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['commissions', organizationId, filters],
    queryFn: () => financialAPI.listCommissions<Commission[]>(filters, organizationId),
    enabled: !!organizationId,
  });
}

export function useApproveCommission() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => {
      const organizationId = organization?.id || profile?.organization_id;
      return financialAPI.commissionAction<Commission>(id, 'approve', {}, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Comissao aprovada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao aprovar comissao", description: error.message, variant: "destructive" });
    },
  });
}

export function usePayCommission() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, payment_proof }: { id: string; payment_proof?: string }) => {
      const organizationId = organization?.id || profile?.organization_id;
      return financialAPI.commissionAction<Commission>(id, 'pay', { payment_proof }, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Pagamento de comissao registrado" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao registrar pagamento", description: error.message, variant: "destructive" });
    },
  });
}

export function useCancelCommission() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) => {
      const organizationId = organization?.id || profile?.organization_id;
      return financialAPI.commissionAction<Commission>(id, 'cancel', { notes }, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Comissao cancelada" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao cancelar comissao", description: error.message, variant: "destructive" });
    },
  });
}

export function useCommissionsByBroker() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['commissions-by-broker', organizationId],
    queryFn: () => financialAPI.commissionsByBroker<Array<{
      user: { id: string; name: string; email: string };
      forecast: number;
      approved: number;
      paid: number;
      total: number;
    }>>(organizationId),
    enabled: !!organizationId,
  });
}
