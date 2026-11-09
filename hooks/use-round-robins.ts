import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type MutationFunctionContext, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { toast } from 'sonner';
import { useActiveOrganizationId } from '@/hooks/use-active-organization';
import { roundRobinsAPI } from '@/lib/api/round-robins';
import { requireActiveOrganizationId as requireOrganizationId } from '@/lib/auth/active-organization';
import type { Json } from '@/lib/supabase/types';
import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';

function roundRobinsQueryKey(organizationId: string | null) {
  return ['round-robins', organizationId] as const;
}

export interface RoundRobinRule {
  is_active?: boolean;
  priority?: number;
  id: string;
  round_robin_id: string;
  match_type: string;
  match_value: string;
  match?: Json | null;
}

export interface RoundRobinMember {
  id: string;
  round_robin_id: string;
  user_id: string | null;
  team_id: string | null;
  position: number;
  weight: number | null;
  is_active?: boolean | null;
  user?: { id: string; name: string; email?: string; avatar_url: string | null };
  leads_count?: number;
}

export interface RoundRobin {
  eligible_user_count?: number;
  revision: number;
  id: string;
  organization_id: string;
  created_by?: string | null;
  created_by_user?: { id: string; name: string | null; email: string | null } | null;
  name: string;
  is_active: boolean | null;
  last_assigned_index: number | null;
  created_at: string;
  strategy: string | null;
  leads_distributed: number | null;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  settings: {
    auto_tag_ids?: string[];
    enable_redistribution?: boolean;
    redistribution_timeout_minutes?: number;
    redistribution_warning_minutes?: number;
    redistribution_max_attempts?: number;
    preserve_position?: boolean;
    require_checkin?: boolean;
    ignore_availability?: boolean;
    reentry_behavior?: 'redistribute' | 'keep_assignee';
    whatsapp_distribution_auto_reply_enabled?: boolean;
    whatsapp_distribution_auto_reply_message?: string;
    whatsapp_distribution_auto_reply_delay_seconds?: number;
    schedule?: Array<{
      day: number;
      enabled: boolean;
      start: string;
      end: string;
    }>;
  } | null;
  reentry_behavior?: 'redistribute' | 'keep_assignee';
  target_pipeline?: { id: string; name: string };
  target_stage?: { id: string; name: string; color: string | null };
  rules: RoundRobinRule[];
  members: RoundRobinMember[];
}

export function useRoundRobins(options: { enabled?: boolean } = {}) {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: roundRobinsQueryKey(organizationId),
    queryFn: async () => {
      return roundRobinsAPI.getRoundRobins(requireOrganizationId(organizationId)) as Promise<RoundRobin[]>;
    },
    enabled: Boolean(organizationId) && options.enabled !== false,
    refetchOnMount: true,
  });
}

export function useManagedQueueSchedules(enabled: boolean) {
  const organizationId = useActiveOrganizationId();
  return useQuery({
    queryKey: ['round-robin-capabilities', organizationId],
    queryFn: () => roundRobinsAPI.managedSchedulesAvailable(requireOrganizationId(organizationId)),
    enabled: Boolean(organizationId) && enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
}

export function useRoundRobin(
  roundRobinId?: string | null,
  options: { enabled?: boolean } = {},
) {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ['round-robin', organizationId, roundRobinId],
    queryFn: () =>
      roundRobinsAPI.getRoundRobin(
        roundRobinId as string,
        requireOrganizationId(organizationId),
      ) as Promise<RoundRobin>,
    enabled:
      Boolean(organizationId && roundRobinId) && options.enabled !== false,
    staleTime: 60_000,
    refetchOnMount: 'always',
  });
}

export function useRoundRobinHistory(
  roundRobinId?: string | null,
  options: { enabled?: boolean } = {},
) {
  const organizationId = useActiveOrganizationId();

  return useInfiniteQuery({
    queryKey: ['round-robin-history', organizationId, roundRobinId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      roundRobinsAPI.getHistory(
        roundRobinId as string,
        requireOrganizationId(organizationId),
        { limit: 50, offset: pageParam },
      ),
    getNextPageParam: (lastPage, pages) => lastPage.length === 50 && pages.length * 50 <= 1_000_000 ? pages.length * 50 : undefined,
    enabled:
      Boolean(organizationId && roundRobinId) && options.enabled !== false,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
}

export function useRoundRobinWhatsAppSessions() {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: [
      'round-robin-whatsapp-sessions',
      scope.organizationId ?? 'none',
      scope.userId ?? 'none',
      scope.accessScope,
    ],
    queryFn: () => roundRobinsAPI.getWhatsAppSessionOptions(scope.organizationId ?? undefined),
    enabled: !!scope.organizationId && !!scope.userId,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
}

export function useRoundRobinMetaForms() {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: [
      'round-robin-meta-forms',
      scope.organizationId ?? 'none',
      scope.userId ?? 'none',
      scope.accessScope,
    ],
    queryFn: () => roundRobinsAPI.getMetaFormOptions(scope.organizationId ?? undefined),
    enabled: !!scope.organizationId && !!scope.userId,
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
}

function useQueueListMutationAccess(queryClient: QueryClient) {
  const accessByMutation = useRef(new WeakMap<MutationFunctionContext, () => boolean>());
  return {
    capture: (_variables: unknown, context: MutationFunctionContext) => {
      const isCurrentAccess = captureQueryClientAccess(queryClient);
      // Execution contexts stay unique even when callers reuse the same input
      // object or a SID returns to its previous value on the same client.
      accessByMutation.current.set(context, isCurrentAccess);
      return isCurrentAccess;
    },
    requireCurrent: (context: MutationFunctionContext) => {
      if (!accessByMutation.current.get(context)?.()) {
        throw new Error('O contexto de acesso mudou. Reabra a gestão antes de alterar a fila.');
      }
    },
  };
}

export function useUpdateRoundRobin() {
  const queryClient = useQueryClient();
  const access = useQueueListMutationAccess(queryClient);
  const organizationId = useActiveOrganizationId();

  return useMutation({
    onMutate: access.capture,
    mutationFn: async ({ id, ...updates }: Partial<RoundRobin> & { id: string }, context) => {
      access.requireCurrent(context);
      return roundRobinsAPI.updateRoundRobin(id, {
        name: updates.name,
        strategy: updates.strategy,
        is_active: updates.is_active,
        target_pipeline_id: updates.target_pipeline_id,
        target_stage_id: updates.target_stage_id,
        settings: updates.settings as Json | null | undefined,
        reentry_behavior: updates.reentry_behavior,
        expectedRevision: updates.revision,
      }, requireOrganizationId(organizationId));
    },
    onSuccess: (queue, variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      queryClient.setQueryData<RoundRobin[]>(roundRobinsQueryKey(organizationId), (current) => current?.map((item) => item.id === queue.id ? queue as RoundRobin : item));
      queryClient.setQueryData(
        ['round-robin', organizationId, variables.id],
        queue,
      );
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      queryClient.invalidateQueries({
        queryKey: ['round-robin', organizationId, variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['round-robin-history', organizationId, variables.id],
      });
    },
    onError: (error, _variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      toast.error('Erro ao atualizar fila: ' + error.message);
    },
  });
}

export function useDeleteRoundRobin() {
  const queryClient = useQueryClient();
  const access = useQueueListMutationAccess(queryClient);
  const organizationId = useActiveOrganizationId();

  return useMutation({
    onMutate: access.capture,
    mutationFn: ({ id, revision }: { id: string; revision: number }, context) => {
      access.requireCurrent(context);
      return roundRobinsAPI.deleteRoundRobin(id, requireOrganizationId(organizationId), revision);
    },
    onSuccess: (_, variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      queryClient.removeQueries({ queryKey: ['round-robin', organizationId, variables.id] });
      queryClient.removeQueries({ queryKey: ['round-robin-history', organizationId, variables.id] });
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: ['round-robin-meta-forms', organizationId] });
      toast.success('Fila excluída!');
    },
    onError: (error, _variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      toast.error('Erro ao excluir fila: ' + error.message);
    },
  });
}

interface UpdateMemberWeight {
  memberId: string;
  weight: number;
}

export function useUpdateRoundRobinMembers() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async ({ members, roundRobinId, revision }: { roundRobinId: string; revision: number; members: UpdateMemberWeight[] }) => {
      const activeOrganizationId = requireOrganizationId(organizationId);
      const queue = queryClient.getQueryData<RoundRobin>(['round-robin', organizationId, roundRobinId]) || queryClient.getQueryData<RoundRobin[]>(roundRobinsQueryKey(organizationId))?.find((item) => item.id === roundRobinId);
      if (!queue || queue.revision !== revision) throw new Error('Recarregue a fila antes de alterar os pesos.');
      return roundRobinsAPI.updateRoundRobin(roundRobinId, {
        expectedRevision: revision,
        members: queue.members.map((member) => ({ id: member.id, type: member.user_id ? 'user' : 'team', entityId: member.user_id || member.team_id || '', teamId: member.user_id ? member.team_id || undefined : undefined, weight: members.find((change) => change.memberId === member.id)?.weight ?? member.weight ?? 1 })),
      }, activeOrganizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      toast.success('Distribuicao atualizada!');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar distribuicao: ' + error.message);
    },
  });
}

interface AddMemberInput {
  revision: number;
  roundRobinId: string;
  userId: string;
  weight?: number;
}

export function useAddRoundRobinMember() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async ({ roundRobinId, userId, weight = 10, revision }: AddMemberInput) => {
      const members = await roundRobinsAPI.addMember(
        { roundRobinId, userId, weight, expectedRevision: revision },
        requireOrganizationId(organizationId),
      );
      return members[0];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      toast.success('Membro adicionado!');
    },
    onError: (error) => {
      toast.error('Erro ao adicionar membro: ' + error.message);
    },
  });
}

export function useRemoveRoundRobinMember() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: ({ memberId, revision }: { memberId: string; revision: number }) => roundRobinsAPI.deleteMember(
      memberId,
      requireOrganizationId(organizationId),
      revision,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      toast.success('Membro removido!');
    },
    onError: (error) => {
      toast.error('Erro ao remover membro: ' + error.message);
    },
  });
}
