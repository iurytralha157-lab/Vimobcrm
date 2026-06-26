import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roundRobinsAPI } from '@/lib/api/round-robins';
import type { Json } from '@/integrations/supabase/types';

export interface RoundRobinRule {
  id: string;
  round_robin_id: string;
  match_type: string;
  match_value: string;
}

export interface RoundRobinMember {
  id: string;
  round_robin_id: string;
  user_id: string;
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

export function useRoundRobins() {
  return useQuery({
    queryKey: ['round-robins'],
    queryFn: async () => {
      return roundRobinsAPI.getRoundRobins() as Promise<RoundRobin[]>;
    },
  });
}

export function useUpdateRoundRobin() {
  const queryClient = useQueryClient();

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
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
    },
    onError: (error) => {
      toast.error('Erro ao atualizar roleta: ' + error.message);
    },
  });
}

export function useDeleteRoundRobin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => roundRobinsAPI.deleteRoundRobin(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
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

  return useMutation({
    mutationFn: async ({ members }: { roundRobinId: string; members: UpdateMemberWeight[] }) => {
      await Promise.all(
        members.map((member) =>
          roundRobinsAPI.updateMember(member.memberId, { weight: member.weight })
        )
      );
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
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

  return useMutation({
    mutationFn: async ({ roundRobinId, userId, weight = 10 }: AddMemberInput) => {
      const members = await roundRobinsAPI.addMember({ roundRobinId, userId, weight });
      return members[0];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Membro adicionado!');
    },
    onError: (error) => {
      toast.error('Erro ao adicionar membro: ' + error.message);
    },
  });
}

export function useRemoveRoundRobinMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => roundRobinsAPI.deleteMember(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Membro removido!');
    },
    onError: (error) => {
      toast.error('Erro ao remover membro: ' + error.message);
    },
  });
}
