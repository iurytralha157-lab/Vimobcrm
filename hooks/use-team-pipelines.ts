import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamsAPI } from '@/lib/api/teams';
import { toast } from 'sonner';

export function useTeamPipelines(teamId?: string) {
  return useQuery({
    queryKey: ['team-pipelines', teamId],
    queryFn: async () => {
      if (!teamId) return [];

      return teamsAPI.listTeamPipelines({ teamId });
    },
    enabled: !!teamId,
  });
}

export function useAllTeamPipelines() {
  return useQuery({
    queryKey: ['all-team-pipelines'],
    queryFn: () => teamsAPI.listTeamPipelines(),
  });
}

export function useAssignPipelineToTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, pipelineId }: { teamId: string; pipelineId: string }) => {
      return teamsAPI.assignPipelineToTeam({ teamId, pipelineId });
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

  return useMutation({
    mutationFn: async ({ teamId, pipelineId }: { teamId: string; pipelineId: string }) => {
      await teamsAPI.removePipelineFromTeam({ teamId, pipelineId });
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

  return useMutation({
    mutationFn: async ({ teamId, userId, isLeader }: { teamId: string; userId: string; isLeader: boolean }) => {
      await teamsAPI.setTeamLeader({ teamId, userId, isLeader });
    },
    onSuccess: (_, { isLeader }) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success(isLeader ? 'Líder definido!' : 'Líder removido');
    },
  });
}
