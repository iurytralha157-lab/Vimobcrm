import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useState } from 'react';
import { leadsAPI, type LeadSensitiveProfile, type LeadUpdateInput } from '@/lib/api/leads';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Tables } from '@/lib/supabase/types';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { VimobAPIError, getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId } from '@/lib/api/vimob-client';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { captureLeadRequestIntent } from '@/lib/lead-request-intent';
import { isDefinitiveLeadReadDenial } from '@/lib/lead-read-access';
import { contactImportScopeKey, createLeadImportScope } from '@/lib/lead-import-scope';
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error';
import { invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';
import { runLeadImportBatch, type ImportBatchProgress } from '@/lib/lead-import-batch';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { invalidateTagCounts } from '@/lib/tags/management';
import { canReuseLeadReadOnMount, type VerifiedLeadRead } from '@/lib/lead-read-snapshot';
import { LeadReadSupersededError, readConsistentLeadSnapshot, reconcileLeadReadCache } from '@/lib/lead-read-consistency';
import { useLeadUpdateCache } from '@/hooks/leads/use-lead-update-cache';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { assertLeadFinancialFields } from '@/lib/validation/lead-financial-values';
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
  confirm_history_link?: true;
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
  import_request_key?: string;
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
type CreateLeadResult = {
  id: string;
  lead: Lead | null;
  leadVisible: boolean;
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
  unstarted: Array<{ index: number; rowNumber: number; name: string }>;
  stopped: boolean;
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
  signal?: AbortSignal;
  shouldContinue?: () => boolean;
};

export type BulkDeleteLeadsResult = {
  deletedIds: string[];
  failures: Array<{ id: string; message: string }>;
  unstartedIds: string[];
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
  queue_pool?: import('@/lib/validation/queue-runtime').QueuePool | null;
  can_operate?: boolean;
  financial_review_required?: boolean;
  tags?: LeadTag[];
  assignee?: { id: string; name: string; avatar_url: string | null };
  stage?: { id: string; name: string; color: string | null; stage_key: string | null };
};

const leadReadRelationKeys = new Set<keyof Lead>(['can_operate', 'financial_review_required', 'queue_pool', 'tags', 'assignee', 'stage']);

export type UpdateLeadInput = Partial<Lead> & {
  id: string;
  expectedUpdatedAt?: string;
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

export function useLead(id: string | null, options: {
  freshOnMount?: boolean;
  verifiedRead?: VerifiedLeadRead<Lead>;
} = {}) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const queryClient = useQueryClient();
  const queryKey = ['lead', organizationId, id];
  const cached = queryClient.getQueryState<Lead>(queryKey);
  const reuseVerifiedRead = canReuseLeadReadOnMount(options.verifiedRead, {
    data: cached?.data,
    dataUpdatedAt: cached?.dataUpdatedAt,
    organizationId,
    leadId: id,
  });

  return useQuery({
    queryKey,
    structuralSharing: (current, incoming) => reconcileLeadReadCache(current as Lead | null | undefined, incoming as Lead | null),
    queryFn: async ({ signal }) => {
      if (!id || !organizationId) return null;

      try {
        return await readConsistentLeadSnapshot<Lead>({
          organizationId, leadId: id, signal,
          read: async () => {
            const { data, error } = await leadsAPI.getLead(id, organizationId, signal);
            if (error) throw error;
            return data as Lead | null;
          },
          getCached: () => queryClient.getQueryData<Lead>(queryKey),
        });
      } catch (error) {
        if (isDefinitiveLeadReadDenial(error)) {
          // Query errors retain previous data by default. Erase this denied
          // snapshot and refresh scoped lists before reporting the error.
          queryClient.setQueryData(queryKey, null);
          void queryClient.invalidateQueries({ queryKey: ['contacts-list', organizationId] });
          void queryClient.invalidateQueries({ queryKey: ['leads', organizationId] });
        }
        throw error;
      }
    },
    enabled: !!id && !!organizationId,
    retry: (count, error) => !(error instanceof LeadReadSupersededError) && !isDefinitiveLeadReadDenial(error) && count < 3,
    ...(options.freshOnMount ? { refetchOnMount: reuseVerifiedRead ? false : 'always' as const } : {}),
  });
}

export function useLeadSensitiveProfile(id: string | null, options: { enabled?: boolean } = {}) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const queryClient = useQueryClient();
  const queryKey = ['lead-sensitive-profile', organizationId, id];
  const query = useQuery<LeadSensitiveProfile>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!id || !organizationId) return {};
      try {
        return await leadsAPI.getSensitiveProfile(id, organizationId, { signal });
      } catch (error) {
        if (!signal.aborted && isDefinitiveLeadReadDenial(error)) queryClient.setQueryData(queryKey, {});
        throw error;
      }
    },
    enabled: Boolean(id && organizationId && options.enabled !== false),
    retry: (count, error) => !isDefinitiveLeadReadDenial(error) && count < 3,
    staleTime: 0,
    gcTime: 0,
  });
  return { ...query, data: options.enabled === false || isDefinitiveLeadReadDenial(query.error) ? undefined : query.data };
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const requestScope = useLeadRequestScope();

  return useMutation<CreateLeadResult, Error, CreateLeadInput, LeadRequestOperation>({
    onMutate: lead => requestScope.bind(lead),
    mutationFn: async (lead) => {
      const operation = requestScope.require(lead);
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:create:${user.id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const { data, error, leadId, leadVisible, reentry, assignedUserName, distributionOutcome } = await leadsAPI.createLead(operation.organizationId, {
        ...lead,
        source: lead.source || 'manual',
      }, operation.intent);

      if (error) throw error;
      return { id: leadId, lead: data, leadVisible, reentry, assignedUserName, distributionOutcome };
    },
    onSuccess: (data, _variables, operation) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-list', operation?.organizationId] });
      invalidateLeadSourceOptions(queryClient);
      if (organizationId && requestScope.isCurrent(operation)) {
        notifyLeadRealtimeChange({
          organizationId,
          leadId: data.id,
          reason: data.reentry ? 'lead.reentered' : 'lead.created',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['lead', operation?.organizationId, data.id] });
        invalidateLeadHistorySoon(queryClient, data.id);
      }
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversation'] });
      if (!requestScope.isCurrent(operation)) return;
      if (!data.leadVisible) {
        toast.success('Lead salvo com sucesso. Você não tem acesso para visualizar esse lead.');
      } else if (data?.reentry) {
        toast.success(`Lead ja existia e foi atualizado. Responsavel atual: ${data.assignedUserName || 'sem responsavel'}`);
      } else {
        toast.success('Lead criado com sucesso!');
      }
    },
    onError: (error, variables, operation) => {
      if (!requestScope.isCurrent(operation || requestScope.contextFor(variables))) return;
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
    onSettled: (_data, _error, variables) => requestScope.release(variables),
  });
}

export function useImportLeads() {
  const queryClient = useQueryClient();
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const sessionId = getGlobalSignOutSessionId(session);
  const scopeKey = contactImportScopeKey(organizationId, user?.id, sessionId);
  const [importScope] = useState(createLeadImportScope);
  useLayoutEffect(() => importScope.activate(scopeKey), [importScope, scopeKey]);

  return useMutation<ImportLeadsResult, Error, CreateLeadInput[] | ImportLeadsMutationInput>({
    mutationFn: async (input) => {
      const rows = Array.isArray(input) ? input : input.rows;
      const onProgress = Array.isArray(input) ? undefined : input.onProgress;
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');
      if (!sessionId) throw new Error('Não foi possível confirmar a sessão. Entre novamente antes de importar.');
      if (rows.length === 0) throw new Error('Nenhum contato válido para importar');

      let created = 0;
      let reentered = 0;
      const distribution = createEmptyImportDistributionSummary();
      const isCurrentScope = importScope.capture(scopeKey);
      const shouldContinue = () => isCurrentScope()
        && getVimobAPIAccessTokenUserId() === user.id
        && getVimobAPIAccessTokenSessionId() === sessionId
        && (Array.isArray(input) || (input.shouldContinue?.() ?? true));

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
          }, { expectedUserId: user.id, expectedSessionId: sessionId });
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
          signal: Array.isArray(input) ? undefined : input.signal,
          shouldContinue,
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
        processed: success + failures.length,
        remaining: batch.unstartedIndexes.length,
        created,
        reentered,
        success,
        failed: failures.length,
        failures,
        unstarted: batch.unstartedIndexes.map(index => ({ index, rowNumber: rows[index].import_row_number ?? index + 2, name: rows[index].name })),
        stopped: batch.stopped,
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
  const requestOperations = useLeadRequestScope();
  const organizationId = activeOrganization.organizationId || undefined;
  const updateCache = useLeadUpdateCache(queryClient, organizationId, user?.id);

  return useMutation({
    onMutate: (variables: UpdateLeadInput) => {
      assertLeadFinancialFields(variables);
      const operation = requestOperations.bind(variables);
      return updateCache.onMutate(variables, operation);
    },
    mutationFn: async (variables: UpdateLeadInput) => {
      const { id, ...updates } = variables;
      const operation = requestOperations.require(variables);
      const requestScope = updateCache.requireRequestScope(variables);

      enforceClientActionRateLimit(`lead:update:${requestScope.actorId}:${id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 30, windowMs: 60_000 },
      ]);

      const updateData = toLeadUpdateInput(updates);

      const { data, error } = await leadsAPI.updateLead(id, updateData, requestScope.organizationId, operation.intent);
      if (error) throw error;
      if (!data) {
        throw new Error('Nenhuma alteração foi gravada. Verifique se você tem permissão para editar este lead.');
      }
      if (data.id !== id || data.organization_id !== requestScope.organizationId) {
        throw new Error('Não foi possível confirmar os dados salvos. Abra o lead novamente.');
      }

      return data;
    },
    onSuccess: updateCache.onSuccess,
    onError: (error, variables, context) => {
      const failedContext = context || updateCache.contextFor(variables);
      updateCache.onError(failedContext);
      if (!updateCache.isCurrent(failedContext)) return;
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao atualizar lead: ' + error.message);
    },
    onSettled: (_data, _error, variables) => {
      requestOperations.release(variables);
      updateCache.release(variables);
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const scopeKey = contactImportScopeKey(organizationId, user?.id, getGlobalSignOutSessionId(session));
  const [operationScope] = useState(createLeadImportScope);
  useLayoutEffect(() => operationScope.activate(scopeKey), [operationScope, scopeKey]);

  return useMutation({
    onMutate: () => ({ isCurrent: operationScope.capture(scopeKey) }),
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:delete:${user.id}:${id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const intent = captureLeadRequestIntent(user.id, getGlobalSignOutSessionId(session));
      if (!operationScope.capture(scopeKey)()) throw new Error('Seu acesso mudou. Confira a lista antes de excluir.');
      const { error } = await leadsAPI.deleteLead(id, organizationId, intent);
      if (error) throw error;
    },
    onSuccess: (_, leadId, context) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-list'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (!context?.isCurrent()) return;
      if (organizationId) {
        notifyLeadRealtimeChange({ organizationId, leadId, reason: 'lead.deleted' });
      }
      toast.success('Contato excluído!');
    },
    onError: (error, _id, context) => {
      if (!context?.isCurrent()) return;
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
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const sessionId = getGlobalSignOutSessionId(session);
  const scopeKey = contactImportScopeKey(organizationId, user?.id, sessionId);
  const [operationScope] = useState(createLeadImportScope);
  useLayoutEffect(() => operationScope.activate(scopeKey), [operationScope, scopeKey]);

  return useMutation<BulkDeleteLeadsResult, Error, string[]>({
    mutationFn: async (inputIds) => {
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      const ids = Array.from(new Set(inputIds.filter(Boolean)));
      if (ids.length === 0) throw new Error('Nenhum contato selecionado');
      if (ids.length > 500) throw new Error('Selecione no máximo 500 contatos por operação');
      const intent = captureLeadRequestIntent(user.id, sessionId);
      const isCurrentScope = operationScope.capture(scopeKey);
      if (!isCurrentScope()) throw new Error('Seu acesso mudou. Confira a lista antes de excluir.');
      const shouldContinue = () => isCurrentScope()
        && getVimobAPIAccessTokenUserId() === user.id
        && getVimobAPIAccessTokenSessionId() === sessionId;

      let cursor = 0;
      const deletedIds: string[] = [];
      const failures: BulkDeleteLeadsResult['failures'] = [];

      const deleteNext = async () => {
        while (cursor < ids.length) {
          if (!shouldContinue()) break;
          const id = ids[cursor];
          cursor += 1;

          try {
            await leadsAPI.deleteLead(id, organizationId, intent);
            deletedIds.push(id);
          } catch (error) {
            failures.push({ id, message: getErrorMessage(error) });
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(3, ids.length) }, () => deleteNext()),
      );

      return { deletedIds, failures, unstartedIds: ids.slice(cursor) };
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
  const requestScope = useLeadRequestScope();

  return useMutation({
    mutationFn: async (variables: { leadId: string; tagId: string }) => {
      const operation = requestScope.require(variables);
      const { leadId, tagId } = variables;
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:tag:add:${user.id}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      // Verificar se a tag já está associada ao lead
      const { error } = await leadsAPI.addLeadTag(leadId, tagId, operation.organizationId, operation.intent);

      if (error) throw error;
    },
    onMutate: variables => ({ organizationId, operation: requestScope.bind(variables) }),
    onSuccess: (_, variables, mutationScope) => {
      if (mutationScope?.organizationId) void invalidateTagCounts(queryClient, mutationScope.organizationId);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (mutationScope?.organizationId && requestScope.isCurrent(mutationScope.operation)) {
        notifyLeadRealtimeChange({
          organizationId: mutationScope.organizationId,
          leadId: variables.leadId,
          reason: 'lead.tagged',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-lead-detail'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversation'] });
      invalidateLeadHistorySoon(queryClient, variables.leadId);
      if (requestScope.isCurrent(mutationScope?.operation)) toast.success('Tag adicionada!');
    },
    onError: (error, variables, context) => {
      if (!requestScope.isCurrent(context?.operation || requestScope.contextFor(variables))) return;
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
    onSettled: (_data, _error, variables) => requestScope.release(variables),
  });
}

export function useRemoveLeadTag() {
  const queryClient = useQueryClient();
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const requestScope = useLeadRequestScope();

  return useMutation({
    mutationFn: async (variables: { leadId: string; tagId: string }) => {
      const operation = requestScope.require(variables);
      const { leadId, tagId } = variables;
      if (!user?.id) throw new Error('Usuário não autenticado');
      if (!organizationId) throw new Error('Usuário não possui organização');

      enforceClientActionRateLimit(`lead:tag:remove:${user.id}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      const { error } = await leadsAPI.removeLeadTag(leadId, tagId, operation.organizationId, operation.intent);

      if (error) throw error;
    },
    onMutate: variables => ({ organizationId, operation: requestScope.bind(variables) }),
    onSuccess: (_, variables, mutationScope) => {
      if (mutationScope?.organizationId) void invalidateTagCounts(queryClient, mutationScope.organizationId);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      if (mutationScope?.organizationId && requestScope.isCurrent(mutationScope.operation)) {
        notifyLeadRealtimeChange({
          organizationId: mutationScope.organizationId,
          leadId: variables.leadId,
          reason: 'lead.untagged',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-lead-detail'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversation'] });
      invalidateLeadHistorySoon(queryClient, variables.leadId);
      if (requestScope.isCurrent(mutationScope?.operation)) toast.success('Tag removida!');
    },
    onError: (error, variables, context) => {
      if (!requestScope.isCurrent(context?.operation || requestScope.contextFor(variables))) return;
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao remover tag: ' + error.message);
    },
    onSettled: (_data, _error, variables) => requestScope.release(variables),
  });
}
