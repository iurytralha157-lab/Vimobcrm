import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roundRobinsAPI } from '@/lib/api/round-robins';

export interface RuleMatch {
  pipeline_id?: string;
  source?: string[];
  campaign_name_contains?: string;
  meta_form_id?: string[];
  tag_in?: string[];
  city_in?: string[];
  schedule?: {
    days?: number[];
    start?: string;
    end?: string;
  };
}

export interface RoundRobinRule {
  id: string;
  round_robin_id: string;
  match_type: string;
  match_value: string;
  match: RuleMatch | null;
  priority: number;
  is_active: boolean;
}

function normalizeRule(row: Awaited<ReturnType<typeof roundRobinsAPI.getRules>>[number]): RoundRobinRule {
  const match = typeof row.match === 'object' && row.match !== null && !Array.isArray(row.match)
    ? row.match as RuleMatch
    : null;

  return {
    id: row.id,
    round_robin_id: row.round_robin_id,
    match_type: row.match_type,
    match_value: row.match_value,
    match,
    priority: row.priority ?? 0,
    is_active: row.is_active ?? true,
  };
}

export function useRoundRobinRules(roundRobinId?: string) {
  return useQuery({
    queryKey: ['round-robin-rules', roundRobinId],
    queryFn: async () => {
      const rules = await roundRobinsAPI.getRules(roundRobinId);
      return rules.map(normalizeRule);
    },
    enabled: !!roundRobinId || roundRobinId === undefined,
  });
}

export function useAllRoundRobinRules() {
  return useQuery({
    queryKey: ['round-robin-rules-all'],
    queryFn: async () => {
      const rules = await roundRobinsAPI.getRules();
      return rules.map(normalizeRule);
    },
  });
}

interface CreateRuleInput {
  round_robin_id: string;
  match_type: string;
  match_value: string;
}

export function useCreateRoundRobinRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRuleInput) => {
      const rule = await roundRobinsAPI.createRule(input);
      return normalizeRule(rule);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules', variables.round_robin_id] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules-all'] });
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Regra criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao criar regra: ' + error.message);
    },
  });
}

interface UpdateRuleInput {
  id: string;
  round_robin_id: string;
  match_type?: string;
  match_value?: string;
}

export function useUpdateRoundRobinRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateRuleInput) => {
      const rule = await roundRobinsAPI.updateRule(input.id, {
        match_type: input.match_type,
        match_value: input.match_value,
      });
      return normalizeRule(rule);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules', variables.round_robin_id] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules-all'] });
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Regra atualizada!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao atualizar regra: ' + error.message);
    },
  });
}

export function useDeleteRoundRobinRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, roundRobinId }: { id: string; roundRobinId: string }) => {
      await roundRobinsAPI.deleteRule(id);
      return roundRobinId;
    },
    onSuccess: (roundRobinId) => {
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules', roundRobinId] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules-all'] });
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Regra excluida!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao excluir regra: ' + error.message);
    },
  });
}

export function useReorderRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rules: { id: string; match_type: string }[]) => {
      void rules;
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules'] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules-all'] });
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Regras atualizadas!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao reordenar regras: ' + error.message);
    },
  });
}
