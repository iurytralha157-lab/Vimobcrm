import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { leadsAPI, type LeadSensitiveProfile, type LeadUpdateInput } from '@/lib/api/leads';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Tables } from '@/lib/supabase/types';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error';
import { invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';
import { runLeadImportBatch, type ImportBatchProgress } from '@/lib/lead-import-batch';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import {
  countImportDistributionOutcome,
  createEmptyImportDistributionSummary,
  resolveImportDistributionOutcome,
  type ImportDistributionSummary,
  type LeadDistributionOutcome,
} from '@/lib/lead-distribution-outcome';
type LeadTag = Pick<Tables<'tags'>, 'id' | 'name' | 'color'>;
export type CreateLeadInput = {
  name: string;
  phone?: string;
  email?: string;
  message?: string;
  feedback?: string;
  source?: string;
  stage_id?: string;
  pipeline_id?: string;
  property_code?: string;
  property_id?: string;
  interest_property_ids?: string[];
  assigned_user_id?: string;
  team_id?: string;
  tag_ids?: string[];
  conversation_id?: string;
  expected_previous_lead_id?: string;
  cargo?: string;
  empresa?: string;
  profissao?: string;
  endereco?: string;
  bairro?: string;
  numero?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  renda_familiar?: string;
  faixa_valor_imovel?: string;
  valor_interesse?: number | null;
  deal_status?: string;
  lost_reason?: string;
  is_own_resource?: boolean;
  import_mode?: boolean;
  auto_distribute?: boolean;
  round_robin_id?: string;
  import_row_number?: number;
  import_validation_error?: string;
  profile?: {
    personType?: 'individual' | 'company';
    gender?: 'male' | 'female' | 'other';
    socialName?: string;
    birthDate?: string;
    cpf?: string;
    rg?: string;
    cnpj?: string;
    corporateName?: string;
    tradeName?: string;
    stateRegistration?: string;
  };
};
type CreateLeadResult = Lead & {
  reentry?: boolean;
  assignedUserName?: string;
  distributionOutcome?: LeadDistributionOutcome;
};

export type ImportLeadsResult = {
  total: number;
  processed: number;
  remaining: number;
  created: number;
  reentered: number;
  success: number;
  failed: number;
  failures: Array<{
    index: number;
    rowNumber: number;
    name: string;
    code: string;
    message: string;
  }>;
  reasons: Array<{ code: string; message: string; count: number }>;
  distribution: ImportDistributionSummary;
};

export type ImportLeadsProgress = ImportBatchProgress & {
  created: number;
  reentered: number;
  distribution: ImportDistributionSummary;
};

export type ImportLeadsMutationInput = {
  rows: CreateLeadInput[];
  onProgress?: (progress: ImportLeadsProgress) => void;
};

export type BulkDeleteLeadsResult = {
  deletedIds: string[];
  failures: Array<{ id: string; message: string }>;
};

function invalidateLeadSourceOptions(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['shared-filter-lead-meta-filters'] });
  queryClient.invalidateQueries({ queryKey: ['lead-meta-filters'] });
}

const getErrorCode = (error: unknown) => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
};

export type Lead = Tables<'leads'> & {
  tags?: LeadTag[];
  assignee?: { id: string; name: string; avatar_url: string | null };
  stage?: { id: string; name: string; color: string | null; stage_key: string | null };
};

const leadReadRelationKeys = new Set<keyof Lead>(['tags', 'assignee', 'stage']);

export type UpdateLeadInput = Partial<Lead> & {
  id: string;
  interest_property_ids?: string[];
  profile?: LeadUpdateInput['profile'];
};

function toLeadUpdateInput(updates: Omit<UpdateLeadInput, 'id'>): LeadUpdateInput {
  return Object.fromEntries(
    Object.entries(updates).filter(([key]) => !leadReadRelationKeys.has(key as keyof Lead))
  ) as LeadUpdateInput;
}

export function useLeads(filters?: {
  stageId?: string;
  assigneeId?: string;
  search?: string;
  limit?: number;
}, options: { enabled?: boolean } = {}) {
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const limit = filters?.limit || 200;

  return useQuery({
    queryKey: ['leads', organizationId, filters],
    queryFn: async () => {
      if (!organizationId) return [] as Lead[];

      const { data, error } = await leadsAPI.getLeads(organizationId, {
        limit,
        stageId: filters?.stageId,
        assigneeId: filters?.assigneeId,
        search: filters?.search,
      });

      if (error) throw error;

      return (data || []) as Lead[];
    },
    enabled: !!user?.id && !!organizationId && options.enabled !== false,
  });
}

export function useLead(id: string | null) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useQuery({
    queryKey: ['lead', organizationId, id],
    queryFn: async () => {
      if (!id || !organizationId) return null;

      const { data, error } = await leadsAPI.getLead(id, organizationId);
      if (error) throw error;

      return data as Lead;
    },
    enabled: !!id && !!organizationId,
  });
}

export function useLeadSensitiveProfile(id: string | null, options: { enabled?: boolean } = {}) {
	const { activeOrganization } = useAuth();
	const organizationId = activeOrganization.organizationId || undefined;

	return useQuery<LeadSensitiveProfile>({
		queryKey: ['lead-sensitive-profile', organizationId, id],
		queryFn: async () => {
			if (!id || !organizationId) return {};
			return leadsAPI.getSensitiveProfile(id, organizationId);
		},
		enabled: Boolean(id && organizationId && options.enabled !== false),
		staleTime: 0,
		gcTime: 0,
	});
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation<CreateLeadResult, Error, CreateLeadInput>({
    mutationFn: async (lead) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:create:${user.id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const { data, error, reentry, assignedUserName, distributionOutcome } = await leadsAPI.createLead(organizationId, {
        ...lead,
        source: lead.source || 'manual',
      });

      if (error) throw error;
      if (!data) {
        throw new Error('Não foi possível concluir a criação do lead. Tente novamente.');
      }

      return { ...data, reentry, assignedUserName, distributionOutcome };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      invalidateLeadSourceOptions(queryClient);
      if (organizationId) {
        notifyLeadRealtimeChange({
          organizationId,
          leadId: data.id,
          reason: data.reentry ? 'lead.reentered' : 'lead.created',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['lead', data.id] });
        invalidateLeadHistorySoon(queryClient, data.id);
      }
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversation'] });
      if (data?.reentry) {
        toast.success(`Lead ja existia e foi atualizado. Responsavel atual: ${data.assignedUserName || 'sem responsavel'}`);
      } else {
        toast.success('Lead criado com sucesso!');
      }
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      if (error instanceof VimobAPIError && error.code === 'lead_already_exists') {
        toast.warning('Atenção: lead não criado, pois já está cadastrado e atribuído a outro responsável. Entre em contato com o administrador.');
        return;
      }
      if (error instanceof VimobAPIError && error.code === 'whatsapp_conversation_binding_changed') {
        toast.warning('A conversa foi vinculada a outro card. Atualize a tela antes de criar o lead.');
        return;
      }
      toast.error('Erro ao criar lead: ' + getErrorMessage(error));
    },
  });
}

export function useImportLeads() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation<ImportLeadsResult, Error, CreateLeadInput[] | ImportLeadsMutationInput>({
    mutationFn: async (input) => {
      const rows = Array.isArray(input) ? input : input.rows;
      const onProgress = Array.isArray(input) ? undefined : input.onProgress;
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');
      if (rows.length === 0) throw new Error('Nenhum contato válido para importar');

      let created = 0;
      let reentered = 0;
      const distribution = createEmptyImportDistributionSummary();

      const batch = await runLeadImportBatch(
        rows,
        async (row) => {
          if (row.import_validation_error) {
            throw Object.assign(new Error(row.import_validation_error), {
              code: 'invalid_import_row',
            });
          }

          const lead = { ...row };
          delete lead.import_row_number;
          delete lead.import_validation_error;
          const result = await leadsAPI.createLead(organizationId, {
            ...lead,
            import_mode: true,
          });
          if (result.reentry) reentered += 1;
          else created += 1;
          countImportDistributionOutcome(distribution, resolveImportDistributionOutcome({
            serverOutcome: result.distributionOutcome,
            reentry: result.reentry,
            autoDistribute: row.auto_distribute,
          }));
        },
        {
          concurrency: 4,
          onProgress: progress => onProgress?.({
            ...progress,
            created,
            reentered,
            distribution: { ...distribution },
          }),
        },
      );
      const failures: ImportLeadsResult['failures'] = batch.failures.map(
        ({ index, error }) => ({
          index,
          rowNumber: rows[index].import_row_number ?? index + 2,
          name: rows[index].name,
          code: getErrorCode(error) || 'import_row_failed',
          message: getErrorMessage(error) || 'Não foi possível importar esta linha',
        }),
      );
      const reasonMap = new Map<string, ImportLeadsResult['reasons'][number]>();
      failures.forEach((failure) => {
        const key = `${failure.code}\u0000${failure.message}`;
        const existing = reasonMap.get(key);
        if (existing) existing.count += 1;
        else reasonMap.set(key, {
          code: failure.code,
          message: failure.message,
          count: 1,
        });
      });

      const success = batch.successIndexes.length;

      return {
        total: rows.length,
        processed: rows.length,
        remaining: 0,
        created,
        reentered,
        success,
        failed: failures.length,
        failures,
        reasons: Array.from(reasonMap.values()).sort((left, right) =>
          right.count - left.count || left.message.localeCompare(right.message),
        ),
        distribution,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-list'] });
      queryClient.invalidateQueries({ queryKey: ['shared-filter-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (result.success > 0) invalidateLeadSourceOptions(queryClient);
      if (organizationId && result.success > 0) {
        notifyLeadRealtimeChange({ organizationId, reason: 'lead.created' });
      }
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateLeadInput) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:update:${user.id}:${id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 30, windowMs: 60_000 },
      ]);

      const updateData = toLeadUpdateInput(updates);

      const { data, error } = await leadsAPI.updateLead(id, updateData, organizationId);
      if (error) throw error;
      if (!data) {
        throw new Error('Nenhuma alteração foi gravada. Verifique se você tem permissão para editar este lead.');
      }

      return data;
    },
    onSuccess: (data, variables) => {
      if (data?.id) {
        queryClient.setQueryData(['lead', organizationId, data.id], data);
        queryClient.setQueriesData<Lead[]>({ queryKey: ['leads'] }, (current) => {
          if (!Array.isArray(current)) return current;
          return current.map((lead) => lead.id === data.id ? { ...lead, ...data } : lead);
        });
        queryClient.setQueriesData<Lead[]>({ queryKey: ['contacts-list'] }, (current) => {
          if (!Array.isArray(current)) return current;
          return current.map((lead) => lead.id === data.id ? { ...lead, ...data } : lead);
        });
        queryClient.setQueriesData<Array<{ leads?: Array<Partial<Lead> & { id: string }> }>>(
          { queryKey: ['stages-with-leads'] },
          (current) => {
            if (!Array.isArray(current)) return current;
            return current.map((stage) => {
              if (!Array.isArray(stage?.leads)) return stage;
              return {
                ...stage,
                leads: stage.leads.map((lead) => lead.id === data.id ? { ...lead, ...data } : lead),
              };
            });
          },
        );

        queryClient.invalidateQueries({ queryKey: ['lead', organizationId, data.id] });
        invalidateLeadHistorySoon(queryClient, data.id);
      }

      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-list'], refetchType: 'active' });
      if (variables.source !== undefined) invalidateLeadSourceOptions(queryClient);
      if (organizationId && data?.id) {
        notifyLeadRealtimeChange({
          organizationId,
          leadId: data.id,
          reason: 'lead.updated',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['activities'], refetchType: 'none' });
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao atualizar lead: ' + error.message);
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:delete:${user.id}:${id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const { error } = await leadsAPI.deleteLead(id, organizationId);
      if (error) throw error;
    },
    onSuccess: (_, leadId) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-list'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (organizationId) {
        notifyLeadRealtimeChange({ organizationId, leadId, reason: 'lead.deleted' });
      }
      toast.success('Contato excluído!');
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao excluir lead: ' + error.message);
    },
  });
}

export function useBulkDeleteLeads() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation<BulkDeleteLeadsResult, Error, string[]>({
    mutationFn: async (inputIds) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      const ids = Array.from(new Set(inputIds.filter(Boolean)));
      if (ids.length === 0) throw new Error('Nenhum contato selecionado');
      if (ids.length > 500) throw new Error('Selecione no máximo 500 contatos por operação');

      let cursor = 0;
      const deletedIds: string[] = [];
      const failures: BulkDeleteLeadsResult['failures'] = [];

      const deleteNext = async () => {
        while (cursor < ids.length) {
          const id = ids[cursor];
          cursor += 1;

          try {
            await leadsAPI.deleteLead(id, organizationId);
            deletedIds.push(id);
          } catch (error) {
            failures.push({ id, message: getErrorMessage(error) });
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(3, ids.length) }, () => deleteNext()),
      );

      return { deletedIds, failures };
    },
    onSuccess: (result) => {
      if (result.deletedIds.length === 0) return;
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-list'] });
      queryClient.invalidateQueries({ queryKey: ['shared-filter-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (organizationId) {
        notifyLeadRealtimeChange({ organizationId, reason: 'lead.deleted' });
      }
    },
  });
}

export function useAddLeadTag() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:tag:add:${user.id}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      // Verificar se a tag já está associada ao lead
      const { error } = await leadsAPI.addLeadTag(leadId, tagId, organizationId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (organizationId) {
        notifyLeadRealtimeChange({
          organizationId,
          leadId: variables.leadId,
          reason: 'lead.tagged',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-lead-detail'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversation'] });
      invalidateLeadHistorySoon(queryClient, variables.leadId);
      toast.success('Tag adicionada!');
    },
    onError: (error: unknown) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      const message = getErrorMessage(error);
      if (getErrorCode(error) === 'tag_already_exists' || message === 'TAG_ALREADY_EXISTS' || message.includes('unique constraint')) {
        toast.info('Esta tag já está adicionada ao lead');
      } else {
        toast.error('Erro ao adicionar tag: ' + message);
      }
    },
  });
}

export function useRemoveLeadTag() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:tag:remove:${user.id}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      const { error } = await leadsAPI.removeLeadTag(leadId, tagId, organizationId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (organizationId) {
        notifyLeadRealtimeChange({
          organizationId,
          leadId: variables.leadId,
          reason: 'lead.untagged',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-lead-detail'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversation'] });
      invalidateLeadHistorySoon(queryClient, variables.leadId);
      toast.success('Tag removida!');
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao remover tag: ' + error.message);
    },
  });
}
