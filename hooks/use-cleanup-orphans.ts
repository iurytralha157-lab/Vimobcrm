import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';

interface OrphanMember {
  member_id: string;
  team_id?: string;
  round_robin_id?: string;
  user_id: string;
  team_name?: string;
  queue_name?: string;
  reason: string;
}

interface OrphanStats {
  teamOrphans: OrphanMember[];
  rrOrphans: OrphanMember[];
  total: number;
}

interface CleanupResult {
  team_members_removed: number;
  round_robin_members_removed: number;
  executed_at: string;
}

export function useOrphanStats() {
  return useQuery<OrphanStats>({
    queryKey: ['orphan-stats'],
    queryFn: async () => {
      return adminAPI.orphanMemberStats<OrphanStats>();
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useCleanupOrphans() {
  const queryClient = useQueryClient();

  return useMutation<CleanupResult, Error>({
    mutationFn: async () => {
      return adminAPI.cleanupOrphanMembers<CleanupResult>();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orphan-stats'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });

      const teamCount = data?.team_members_removed || 0;
      const rrCount = data?.round_robin_members_removed || 0;

      if (teamCount > 0 || rrCount > 0) {
        toast.success(`Limpeza concluída: ${teamCount} de equipes, ${rrCount} de filas de distribuição`);
      } else {
        toast.info('Nenhum membro órfão encontrado para remover');
      }
    },
    onError: (error) => {
      console.error('[useCleanupOrphans] Error:', error);
      toast.error('Erro ao executar limpeza: ' + error.message);
    },
  });
}
