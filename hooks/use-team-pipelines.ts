import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamsAPI } from '@/lib/api/teams';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export function useTeamPipelines(teamId?: string) {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useQuery({
    queryKey: ['team-pipelines', organizationId, teamId],
    queryFn: async () => {
      if (!teamId) return [];

      return teamsAPI.listTeamPipelines({ teamId, organizationId });
    },
    enabled: Boolean(organizationId && teamId),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useAllTeamPipelines(options?: { enabled?: boolean }) {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useQuery({
    queryKey: ['all-team-pipelines', organizationId],
    queryFn: () => teamsAPI.listTeamPipelines({ organizationId }),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useAssignPipelineToTeam() {
  const queryClient = useQueryClient();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useMutation({
    mutationFn: async ({ teamId, pipelineId }: { teamId: string; pipelineId: string }) => {
      return teamsAPI.assignPipelineToTeam({ teamId, pipelineId }, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['all-team-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      toast.success('Pipeline vinculada à equipe!');
    },
    onError: (error: Error) => {
      if (error.message?.includes('duplicate')) {
        toast.error('Pipeline já está vinculada a esta equipe');
      } else {
        toast.error('Erro ao vincular pipeline: ' + error.message);
      }
    },
  });
}

export function useRemovePipelineFromTeam() {
  const queryClient = useQueryClient();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useMutation({
    mutationFn: async ({ teamId, pipelineId }: { teamId: string; pipelineId: string }) => {
      await teamsAPI.removePipelineFromTeam({ teamId, pipelineId }, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['all-team-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      toast.success('Pipeline removida da equipe');
    },
  });
}

export function useSetTeamLeader() {
  const queryClient = useQueryClient();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useMutation({
    mutationFn: async ({ teamId, userId, isLeader }: { teamId: string; userId: string; isLeader: boolean }) => {
      await teamsAPI.setTeamLeader({ teamId, userId, isLeader }, organizationId);
    },
    onSuccess: (_, { isLeader }) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success(isLeader ? 'Líder definido!' : 'Líder removido');
    },
  });
}
