import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { financialAPI } from "@/lib/api/financial";
import { useToast } from "@/hooks/use-toast";

export interface ContractBroker {
  id: string;
  contract_id: string;
  user_id: string;
  commission_percentage: number;
  commission_value?: number;
  role?: string;
  created_at: string;
  user?: { id: string; name: string; email: string };
}

export interface Contract {
  id: string;
  organization_id: string;
  contract_number: string | null;
  contract_type: string | null;
  status: string | null;
  property_id?: string | null;
  lead_id?: string | null;
  value: number | null;
  commission_percentage: number | null;
  commission_value: number | null;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  client_document?: string | null;
  down_payment?: number | null;
  installments?: number | null;
  payment_conditions?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  signing_date?: string | null;
  closing_date?: string | null;
  notes?: string | null;
  attachments?: unknown;
  created_by?: string | null;
  created_at: string | null;
  updated_at: string | null;
  property?: { id: string; code: string; title: string | null } | null;
  lead?: { id: string; name: string } | null;
  brokers?: ContractBroker[];
}

type CreateContractInput = Omit<Partial<Contract>, 'brokers'> & {
  brokers?: { user_id: string; commission_percentage: number }[];
};

type UpdateContractInput = Omit<Partial<Contract>, 'brokers'> & {
  id: string;
  brokers?: { user_id: string; commission_percentage: number }[];
};

export function useContracts(filters?: { status?: string; type?: string }) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['contracts', organizationId, filters],
    queryFn: () => financialAPI.listContracts<Contract[]>(filters, organizationId),
    enabled: !!organizationId,
  });
}

export function useContract(id: string | undefined) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ['contract', id],
    queryFn: () => (id ? financialAPI.getContract<Contract>(id, organizationId) : null),
    enabled: !!id && !!organizationId,
  });
}

export function useCreateContract() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateContractInput) => {
      const orgId = organization?.id || profile?.organization_id;
      if (!orgId) throw new Error('Organizacao nao encontrada');
      return financialAPI.createContract<Contract>(data, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      toast({ title: "Contrato criado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar contrato", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateContract() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateContractInput) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.updateContract<Contract>(id, data, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract'] });
      toast({ title: "Contrato atualizado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar contrato", description: error.message, variant: "destructive" });
    },
  });
}

export function useActivateContract() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ contractId, skipCommissions = false }: { contractId: string; skipCommissions?: boolean }) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.activateContract<Contract>(contractId, { skipCommissions }, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract'] });
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({ title: "Contrato ativado com sucesso", description: "Lancamentos financeiros gerados." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao ativar contrato", description: error.message, variant: "destructive" });
    },
  });
}

export function useRegenerateCommissions() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (contractId: string) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.regenerateCommissions<{ commissionsCount: number; totalValue: number }>(contractId, orgId);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract'] });
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['financial-entries'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      toast({
        title: "Comissoes regeneradas",
        description: `${data.commissionsCount} comissoes criadas totalizando R$ ${data.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao regenerar comissoes", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteContract() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => {
      const orgId = organization?.id || profile?.organization_id;
      return financialAPI.deleteContract(id, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      toast({ title: "Contrato excluido com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir contrato", description: error.message, variant: "destructive" });
    },
  });
}
