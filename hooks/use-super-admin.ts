import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { getFriendlyErrorMessage } from '@/lib/error-handler';
import { adminAPI } from '@/lib/api/admin';

export interface OrganizationWithStats {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  subscription_status: string;
  max_users: number;
  admin_notes: string | null;
  created_at: string;
  last_access_at: string | null;
  user_count?: number;
  lead_count?: number;
  plan_id?: string | null;
  subscription_value?: number | null;
  billing_day?: number | null;
  next_billing_date?: string | null;
  asaas_customer_id?: string | null;
  asaas_subscription_id?: string | null;
  segment?: string | null;
  creci?: string | null;
  max_whatsapp_sessions_override?: number | null;
}

export function useSuperAdmin() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const isReady = !authLoading && isSuperAdmin === true;

  const { data: organizations, isLoading: loadingOrgs } = useQuery({
    queryKey: ['super-admin-organizations'],
    queryFn: async () => (await adminAPI.listOrganizations()) as unknown as OrganizationWithStats[],
    enabled: isReady,
  });

  const { data: allUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ['super-admin-users'],
    queryFn: () => adminAPI.listUsers(),
    enabled: isReady,
  });

  const createOrganization = useMutation({
    mutationFn: (data: {
      name: string;
      segment?: 'imobiliario' | 'servicos';
      adminEmail: string;
      adminName: string;
      adminPassword: string;
      whatsapp?: string;
      phone?: string;
      cnpj?: string;
      creci?: string;
      planId?: string | null;
      address?: string;
      city?: string;
      neighborhood?: string;
      number?: string;
      complement?: string;
      cpf?: string;
    }) => adminAPI.createOrganization(data),
    onSuccess: (data) => {
      const orgName = String(data.organization?.name || 'Organizacao');
      toast.success(`Organizacao "${orgName}" criada com sucesso!`);
      queryClient.invalidateQueries({ queryKey: ['super-admin-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['super-admin-users'] });
    },
    onError: (error) => {
      toast.error('Erro ao criar organizacao: ' + getFriendlyErrorMessage(error));
    },
  });

  const updateOrganization = useMutation({
    mutationFn: (data: {
      id: string;
      name?: string;
      is_active?: boolean;
      subscription_status?: string;
      max_users?: number;
      admin_notes?: string;
      plan_id?: string | null;
      subscription_value?: number | null;
      billing_day?: number | null;
      next_billing_date?: string | null;
      creci?: string | null;
      max_whatsapp_sessions_override?: number | null;
    }) => adminAPI.updateOrganization(data),
    onSuccess: (_, variables) => {
      toast.success('Organizacao atualizada!');
      queryClient.invalidateQueries({ queryKey: ['super-admin-organizations'] });
      if (variables.id) {
        queryClient.invalidateQueries({ queryKey: ['org-details', variables.id] });
      }
    },
    onError: (error) => {
      toast.error('Erro ao atualizar: ' + getFriendlyErrorMessage(error));
    },
  });

  const deleteOrganization = useMutation({
    mutationFn: (organizationId: string) => adminAPI.deleteOrganization(organizationId),
    onSuccess: () => {
      toast.success('Organizacao desativada com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['super-admin-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['super-admin-users'] });
    },
    onError: (error) => {
      toast.error('Erro ao desativar organizacao: ' + getFriendlyErrorMessage(error));
    },
  });

  const updateModuleAccess = useMutation({
    mutationFn: (data: { organizationId: string; moduleName: string; isEnabled: boolean }) =>
      adminAPI.updateModuleAccess(data),
    onSuccess: () => {
      toast.success('Acesso ao modulo atualizado!');
      queryClient.invalidateQueries({ queryKey: ['organization-modules'] });
    },
    onError: (error) => {
      toast.error('Erro ao atualizar modulo: ' + getFriendlyErrorMessage(error));
    },
  });

  const updateUser = useMutation({
    mutationFn: (data: { userId: string; is_active?: boolean; organization_id?: string | null }) =>
      adminAPI.updateUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-users'] });
    },
    onError: (error) => {
      toast.error('Erro ao atualizar usuario: ' + getFriendlyErrorMessage(error));
    },
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => adminAPI.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-users'] });
    },
    onError: (error) => {
      toast.error('Erro ao excluir usuario: ' + getFriendlyErrorMessage(error));
    },
  });

  const stats = {
    totalOrganizations: organizations?.length || 0,
    activeOrganizations: organizations?.filter((org) => org.is_active).length || 0,
    trialOrganizations: organizations?.filter((org) => org.subscription_status === 'trial').length || 0,
    suspendedOrganizations: organizations?.filter((org) => org.subscription_status === 'suspended').length || 0,
    totalUsers: allUsers?.length || 0,
  };

  return {
    organizations,
    allUsers,
    loadingOrgs,
    loadingUsers,
    stats,
    createOrganization,
    updateOrganization,
    updateModuleAccess,
    deleteOrganization,
    updateUser,
    deleteUser,
  };
}
