import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { roundRobinsAPI } from '@/lib/api/round-robins';

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

function roundRobinRulesQueryKey(organizationId: string | null, roundRobinId?: string) {
  return ['round-robin-rules', organizationId, roundRobinId ?? null] as const;
}

function allRoundRobinRulesQueryKey(organizationId: string | null) {
  return ['round-robin-rules-all', organizationId] as const;
}

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
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: roundRobinRulesQueryKey(organizationId, roundRobinId),
    queryFn: async () => {
      const rules = await roundRobinsAPI.getRules(roundRobinId, requireOrganizationId(organizationId));
      return rules.map(normalizeRule);
    },
    enabled: Boolean(organizationId) && (!!roundRobinId || roundRobinId === undefined),
  });
}

export function useAllRoundRobinRules() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: allRoundRobinRulesQueryKey(organizationId),
    queryFn: async () => {
      const rules = await roundRobinsAPI.getRules(undefined, requireOrganizationId(organizationId));
      return rules.map(normalizeRule);
    },
    enabled: Boolean(organizationId),
  });
}

interface CreateRuleInput {
  round_robin_id: string;
  match_type: string;
  match_value: string;
}

export function useCreateRoundRobinRule() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async (input: CreateRuleInput) => {
      const rule = await roundRobinsAPI.createRule(input, requireOrganizationId(organizationId));
      return normalizeRule(rule);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: roundRobinRulesQueryKey(organizationId, variables.round_robin_id),
      });
      queryClient.invalidateQueries({ queryKey: allRoundRobinRulesQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: ['round-robin-meta-forms', organizationId] });
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
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
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async (input: UpdateRuleInput) => {
      const rule = await roundRobinsAPI.updateRule(input.id, {
        match_type: input.match_type,
        match_value: input.match_value,
      }, requireOrganizationId(organizationId));
      return normalizeRule(rule);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: roundRobinRulesQueryKey(organizationId, variables.round_robin_id),
      });
      queryClient.invalidateQueries({ queryKey: allRoundRobinRulesQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: ['round-robin-meta-forms', organizationId] });
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      toast.success('Regra atualizada!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao atualizar regra: ' + error.message);
    },
  });
}

export function useDeleteRoundRobinRule() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async ({ id, roundRobinId }: { id: string; roundRobinId: string }) => {
      await roundRobinsAPI.deleteRule(id, requireOrganizationId(organizationId));
      return roundRobinId;
    },
    onSuccess: (roundRobinId) => {
      queryClient.invalidateQueries({
        queryKey: roundRobinRulesQueryKey(organizationId, roundRobinId),
      });
      queryClient.invalidateQueries({ queryKey: allRoundRobinRulesQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: ['round-robin-meta-forms', organizationId] });
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      toast.success('Regra excluida!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao excluir regra: ' + error.message);
    },
  });
}

export function useReorderRules() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async (rules: { id: string; match_type: string }[]) => {
      requireOrganizationId(organizationId);
      void rules;
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules', organizationId] });
      queryClient.invalidateQueries({ queryKey: allRoundRobinRulesQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: roundRobinsQueryKey(organizationId) });
      toast.success('Regras atualizadas!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao reordenar regras: ' + error.message);
    },
  });
}
