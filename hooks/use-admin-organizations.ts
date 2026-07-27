import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';

export interface AdminOrganization {
  id: string;
  name: string;
  email: string | null;
  cnpj: string | null;
  logo_url: string | null;
  is_active: boolean;
  subscription_status: string;
  subscription_type: string;
  segment: string | null;
  plan_id: string | null;
  plan_name: string | null;
  created_at: string;
  last_access_at: string | null;
  user_count: number;
  lead_count: number;
  automation_count: number;
  mrr: number;
  health_score: number;
  days_trial_left: number;
  overdue_amount: number;
}

export interface AdminOrganizationDeleteResult {
  ok: boolean;
  deleted_users?: number;
  cleanup_warnings?: string[];
}

export function useAdminOrganizationsList(filters: { search?: string; status?: string; segment?: string } = {}) {
  const { search = '', status = 'all', segment = 'all' } = filters;

  return useQuery({
    queryKey: ['admin-organizations-list', search, status, segment],
    queryFn: async (): Promise<AdminOrganization[]> => {
      return (await adminAPI.listOrganizations({ search, status, segment })) as unknown as AdminOrganization[];
    },
    staleTime: 30_000,
  });
}

export function useAdminOrganizationActions() {
  const queryClient = useQueryClient();

  const toggleStatus = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await adminAPI.updateOrganization({ id, is_active: isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-organizations-list'] });
      toast.success('Status da organização atualizado');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar status: ' + error.message);
    },
  });

  const deleteOrganization = useMutation({
    mutationFn: async ({
      id,
      confirmationName,
    }: {
      id: string;
      confirmationName: string;
    }): Promise<AdminOrganizationDeleteResult> => {
      return adminAPI.deleteOrganization(id, confirmationName);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-organizations-list'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-rows', 'organizations'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-rows', 'users'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin-organizations'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin-users'] }),
      ]);
      if ((result.cleanup_warnings || []).length > 0) {
        toast.warning('Organização excluída. Uma conta de acesso residual precisa de revisão técnica.');
        return;
      }
      toast.success('Organização e dados vinculados excluídos permanentemente.');
    },
    onError: (error) => {
      toast.error('Erro ao excluir organização: ' + error.message);
    },
  });

  return {
    toggleStatus,
    deleteOrganization,
  };
}
