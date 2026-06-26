import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';

export interface AdminOrganization {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  subscription_status: string;
  subscription_type: string;
  segment: string | null;
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
      toast.success('Status da organizacao atualizado');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar status: ' + error.message);
    },
  });

  return {
    toggleStatus,
  };
}
