import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { roundRobinsAPI } from '@/lib/api/round-robins';
import type { Json } from '@/integrations/supabase/types';
import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope';

function useActiveOrganizationId() {
  const { organization, profile } = useAuth();
  return organization?.id || profile?.organization_id || null;
}

function requireOrganizationId(organizationId: string | null) {
  if (!organizationId) throw new Error('Organização não selecionada.');
  return organizationId;
}

function roundRobinsQueryKey(organizationId: string | null) {
  return ['round-robins', organizationId] as const;
}

export interface RoundRobinRule {
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
  user?: { id: string; name: string; email?: string; avatar_url: string | null };
  leads_count?: number;
}

export interface RoundRobin {
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
    enable_redistribution?: boolean;
    redistribution_timeout_minutes?: number;
    redistribution_warning_minutes?: number;
    redistribution_max_attempts?: number;
    preserve_position?: boolean;
    require_checkin?: boolean;
    ignore_availability?: boolean;
    reentry_behavior?: 'redistribute' | 'keep_assignee';
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

export function useUpdateRoundRobin() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<RoundRobin> & { id: string }) => {
      return roundRobinsAPI.updateRoundRobin(id, {
        name: updates.name,
        strategy: updates.strategy,
        is_active: updates.is_active,
        target_pipeline_id: updates.target_pipeline_id,
        target_stage_id: updates.target_stage_id,
        settings: updates.settings as Json | null | undefined,
        reentry_behavior: updates.reentry_behavior,
      }, requireOrganizationId(organizationId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
    },
    onError: (error) => {
      toast.error('Erro ao atualizar roleta: ' + error.message);
    },
  });
}

export function useDeleteRoundRobin() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: (id: string) => roundRobinsAPI.deleteRoundRobin(id, requireOrganizationId(organizationId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: ['round-robin-meta-forms', organizationId] });
      toast.success('Roleta excluida!');
    },
    onError: (error) => {
      toast.error('Erro ao excluir roleta: ' + error.message);
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
    mutationFn: async ({ members }: { roundRobinId: string; members: UpdateMemberWeight[] }) => {
      const activeOrganizationId = requireOrganizationId(organizationId);
      await Promise.all(
        members.map((member) =>
          roundRobinsAPI.updateMember(member.memberId, { weight: member.weight }, activeOrganizationId)
        )
      );
      return true;
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
  roundRobinId: string;
  userId: string;
  weight?: number;
}

export function useAddRoundRobinMember() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async ({ roundRobinId, userId, weight = 10 }: AddMemberInput) => {
      const members = await roundRobinsAPI.addMember(
        { roundRobinId, userId, weight },
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
    mutationFn: (memberId: string) => roundRobinsAPI.deleteMember(
      memberId,
      requireOrganizationId(organizationId),
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
