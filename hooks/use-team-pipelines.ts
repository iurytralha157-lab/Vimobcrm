import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { teamsAPI } from '@/lib/api/teams';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { getPublicErrorMessage } from '@/lib/api/vimob-error';

function usePipelineNotificationScope(organizationId: string | null) {
  const scope = useRef(organizationId);
  useEffect(() => {
    scope.current = organizationId;
    return () => { scope.current = null; };
  }, [organizationId]);
  return scope;
}

async function invalidateTeamPipelineQueries(queryClient: ReturnType<typeof useQueryClient>, organizationId: string) {
  await Promise.all(['team-pipelines', 'all-team-pipelines', 'pipelines', 'team-history', 'team-editor-snapshot'].map((key) =>
    queryClient.invalidateQueries({ queryKey: [key, organizationId] }),
  ));
}

export function useTeamPipelines(teamId?: string) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ['team-pipelines', organizationId, teamId],
    queryFn: async () => {
      if (!teamId) return [];

      return teamsAPI.listTeamPipelines({ teamId, organizationId });
    },
    enabled: Boolean(organizationId && teamId),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: true,
  });
}

export function useAllTeamPipelines(options?: { enabled?: boolean }) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ['all-team-pipelines', organizationId],
    queryFn: () => teamsAPI.listTeamPipelines({ organizationId }),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: true,
  });
}

export function useAssignPipelineToTeam() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const notificationScope = usePipelineNotificationScope(organizationId);

  return useMutation({
    onMutate: () => ({ organizationId }),
    mutationFn: async ({ teamId, pipelineId }: { teamId: string; pipelineId: string }) => {
      if (!organizationId) throw new Error('A organização ainda não está disponível.');
      const relation = await teamsAPI.assignPipelineToTeam({ teamId, pipelineId }, organizationId);
      return { relation, organizationId };
    },
    onSuccess: async ({ organizationId: mutationOrganizationId }) => {
      await invalidateTeamPipelineQueries(queryClient, mutationOrganizationId);
      if (notificationScope.current === mutationOrganizationId) toast.success('Pipeline vinculada à equipe!');
    },
    onError: (error: Error, _variables, context) => {
      if (notificationScope.current !== context?.organizationId) return;
      if (error.message?.includes('duplicate')) {
        toast.error('Pipeline já está vinculada a esta equipe');
      } else {
        toast.error('Erro ao vincular pipeline: ' + getPublicErrorMessage(error));
      }
    },
  });
}

export function useRemovePipelineFromTeam() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const notificationScope = usePipelineNotificationScope(organizationId);

  return useMutation({
    onMutate: () => ({ organizationId }),
    mutationFn: async ({ teamId, pipelineId }: { teamId: string; pipelineId: string }) => {
      if (!organizationId) throw new Error('A organização ainda não está disponível.');
      await teamsAPI.removePipelineFromTeam({ teamId, pipelineId }, organizationId);
      return { organizationId };
    },
    onSuccess: async ({ organizationId: mutationOrganizationId }) => {
      await invalidateTeamPipelineQueries(queryClient, mutationOrganizationId);
      if (notificationScope.current === mutationOrganizationId) toast.success('Pipeline removida da equipe');
    },
    onError: (error, _variables, context) => {
      if (notificationScope.current === context?.organizationId) toast.error('Erro ao remover vínculo: ' + getPublicErrorMessage(error));
    },
  });
}

export function useSetTeamLeader() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

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
