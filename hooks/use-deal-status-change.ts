import { useLayoutEffect, useRef } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { leadsAPI } from '@/lib/api/leads';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { lostReasonSchema } from '@/lib/validation';
import type { Lead } from '@/hooks/use-leads';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { appendOptimisticHistoryEvent, invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';
import { formatBRLCurrencyWithDefaultDecimals } from '@/lib/utils/formatting';
import { compareServerRevisions } from '@/lib/compare-server-revisions';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { getLeadStatusFinancialReviewMessage } from '@/lib/lead-financial-review';
import { applyScopedLeadStatusPatch, rollbackScopedLeadStatusPatch, invalidateScopedLeadStatus,
  type LeadStatusCacheRollback, type LeadStatusCachePatch } from '@/lib/pipeline-status-cache';

export interface ChangeDealStatusParams {
  leadId: string;
  newStatus: 'open' | 'won' | 'lost';
  organizationId: string;
  organizationName?: string | null;
  userId: string | null;
  propertyId: string | null;
  valorInteresse: number | null;
  commissionPercentage: number | null;
  leadName: string;
  lostReason?: string | null;
  // Pass the authorized GET result, never local/optimistic form state.
  authorizedLead?: Lead;
  expectedUpdatedAt?: string;
}
type DealStatus = ChangeDealStatusParams['newStatus'];
type StatusResult = { lead: Lead; newStatus: DealStatus; financialReviewRequired: boolean };
type StatusAccessScope = {
  organizationId: string | null | undefined;
  actorId: string | null;
  client: QueryClient;
  canOperate: boolean;
};
type MutationState = {
  variables: ChangeDealStatusParams;
  token: symbol;
  actorId: string | null;
  accessScope: StatusAccessScope;
  operation: LeadRequestOperation;
  authorizedLead?: Lead;
  rollback?: LeadStatusCacheRollback;
  historyId?: string;
};
const pendingByClient = new WeakMap<QueryClient, Map<string, MutationState>>();
let eventSequence = 0;
const statusLabels: Record<DealStatus, string> = { open: 'Aberto', won: 'Ganho', lost: 'Perdido' };

export class LeadStatusOutcomeUncertainError extends Error {
  constructor() {
    super('Não foi possível confirmar a alteração. Os dados do lead estão sendo atualizados; confira o status antes de tentar novamente.');
    this.name = 'LeadStatusOutcomeUncertainError';
  }
}
export function isLeadStatusOutcomeUncertainError(error: unknown): boolean {
  return error instanceof LeadStatusOutcomeUncertainError;
}
class LeadStatusPendingError extends Error {
  constructor() { super('Já existe uma alteração deste lead em andamento.'); }
}
class LeadStatusScopeChangedError extends Error {
  constructor() { super('O acesso ao lead mudou. Abra o lead novamente.'); }
}
function pending(client: QueryClient) {
  let mutations = pendingByClient.get(client);
  if (!mutations) { mutations = new Map(); pendingByClient.set(client, mutations); }
  return mutations;
}
function identity(params: ChangeDealStatusParams) { return JSON.stringify([params.organizationId, params.leadId]); }
function validLead(lead: Lead | null | undefined, params: ChangeDealStatusParams) {
  return Boolean(lead && lead.id === params.leadId && lead.organization_id === params.organizationId &&
    (lead.deal_status === 'open' || lead.deal_status === 'won' || lead.deal_status === 'lost'));
}
function requireAuthorizedLead(lead: Lead | null | undefined, params: ChangeDealStatusParams): Lead {
  if (!validLead(lead, params) || !lead || lead.can_operate !== true) {
    throw new Error('Não foi possível confirmar sua permissão para alterar este lead. Abra o lead novamente.');
  }
  if (!lead.updated_at || !Number.isFinite(Date.parse(lead.updated_at)) ||
    (params.expectedUpdatedAt && params.expectedUpdatedAt !== lead.updated_at)) {
    throw new Error('A versão deste lead mudou. Abra o lead novamente antes de alterar o status.');
  }
  return lead;
}
function uncertainWrite(error: unknown) {
  if (error instanceof VimobAPIError) return error.status === 0 || error.status === 408 || error.status >= 500;
  // Validation before transport is a definite rejection. Other failures after
  // starting the write (network, invalid response, etc.) cannot prove rollback.
  return !(error instanceof Error && error.name === 'ZodError');
}
function canonicalPatch(lead: Lead): LeadStatusCachePatch {
  return {
    deal_status: lead.deal_status, lost_reason: lead.lost_reason ?? null, updated_at: lead.updated_at,
    property_id: lead.property_id, interest_property_id: lead.interest_property_id,
    stage_id: lead.stage_id, pipeline_id: lead.pipeline_id,
    assigned_user_id: lead.assigned_user_id, team_id: lead.team_id,
    valor_interesse: lead.valor_interesse, commission_percentage: lead.commission_percentage,
    ...(Array.isArray(lead.tags) ? { tags: lead.tags } : {}),
    ...(lead.assignee === null || lead.assigned_user_id === null
      ? { assignee: null } : lead.assignee ? { assignee: lead.assignee } : {}),
    ...(lead.stage ? { stage: lead.stage } : {}),
    ...(typeof lead.can_operate === 'boolean' ? { can_operate: lead.can_operate } : {}),
    won_at: lead.deal_status === 'won' ? lead.won_at ?? null : null,
    lost_at: lead.deal_status === 'lost' ? lead.lost_at ?? null : null,
  };
}
function removeOptimisticHistory(client: QueryClient, state?: MutationState) {
  if (!state?.historyId) return;
  client.setQueriesData<UnifiedHistoryEvent[]>({ queryKey: ['lead-history-v2', state.variables.leadId] },
    (events) => Array.isArray(events) ? events.filter((event) => event.id !== state.historyId) : events);
}

export function useDealStatusChange() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const requestScope = useLeadRequestScope();
  const { hasPermission } = useUserPermissions();
  const organizationId = auth.activeOrganization.organizationId;
  const actorId = auth.user?.id ?? null;
  const canOperate = hasPermission('lead_operate');
  const mounted = useRef(true);
  const scope = useRef<StatusAccessScope>({ organizationId, actorId, client: queryClient, canOperate });
  useLayoutEffect(() => { scope.current = { organizationId, actorId, client: queryClient, canOperate }; },
    [organizationId, actorId, queryClient, canOperate]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const hasSameScope = (state: MutationState) => scope.current.canOperate && scope.current.client === queryClient &&
    scope.current.organizationId === state.variables.organizationId && scope.current.actorId === state.actorId;
  const canReconcile = (state: MutationState) => scope.current === state.accessScope && hasSameScope(state) &&
    state.operation.canReconcileCapturedAccess();
  const isCurrent = (state: MutationState) => mounted.current && scope.current === state.accessScope &&
    hasSameScope(state) && state.operation.isCurrent();
  const requireCurrent = (state: MutationState) => {
    if (!isCurrent(state)) throw new LeadStatusScopeChangedError();
  };
  const resultFrom = (lead: Lead, variables: ChangeDealStatusParams): StatusResult => {
    const cached = queryClient.getQueryData<Lead>(['lead', variables.organizationId, variables.leadId]);
    const latest = validLead(cached, variables) && cached &&
      compareServerRevisions(cached.updated_at, lead.updated_at) === 1 ? cached : lead;
    return { lead: latest, newStatus: latest.deal_status as DealStatus, financialReviewRequired: lead.financial_review_required === true };
  };
  const release = (state?: MutationState) => {
    if (state && pending(queryClient).get(identity(state.variables))?.token === state.token) {
      pending(queryClient).delete(identity(state.variables));
    }
  };

  return useMutation<StatusResult, Error, ChangeDealStatusParams, MutationState>({
    mutationKey: ['lead-deal-status', auth.activeOrganization.organizationId],
    retry: false,
    onMutate: async (variables) => {
      if (!variables.organizationId || !variables.leadId || !Object.hasOwn(statusLabels, variables.newStatus)) {
        throw new Error('Não foi possível identificar o lead e sua organização.');
      }
      if (variables.newStatus === 'lost') lostReasonSchema.parse(variables.lostReason || '');
      const operation = requestScope.bind(variables);
      if (operation.organizationId !== variables.organizationId) throw new LeadStatusScopeChangedError();
      const state: MutationState = { variables, token: Symbol(), actorId: operation.userId, accessScope: scope.current, operation };
      requireCurrent(state);
      if (pending(queryClient).has(identity(variables))) throw new LeadStatusPendingError();
      pending(queryClient).set(identity(variables), state);
      try {
        let read = variables.authorizedLead;
        if (!read) {
          const result = await leadsAPI.getLead(variables.leadId, variables.organizationId, state.operation.intent.signal, { ...state.operation.intent, retry: false });
          if (result.error) throw result.error;
          read = result.data as Lead;
        }
        requireCurrent(state);
        state.authorizedLead = requireAuthorizedLead(read, variables);
        const cached = queryClient.getQueryData<Lead>(['lead', variables.organizationId, variables.leadId]);
        if (variables.authorizedLead && cached && (cached.updated_at !== read?.updated_at ||
          cached.assigned_user_id !== read?.assigned_user_id || cached.team_id !== read?.team_id || cached.can_operate === false)) {
          throw new Error('Os dados deste lead mudaram. Abra o lead novamente antes de alterar o status.');
        }
        await Promise.all([
          queryClient.cancelQueries({ queryKey: ['stages-with-leads', variables.organizationId] }),
          queryClient.cancelQueries({ queryKey: ['leads', variables.organizationId] }),
          queryClient.cancelQueries({ queryKey: ['lead', variables.organizationId, variables.leadId], exact: true }),
          queryClient.cancelQueries({ queryKey: ['lead-history-v2', variables.leadId] }),
        ]);
        requireCurrent(state);
        const timestamp = new Date().toISOString();
        state.rollback = applyScopedLeadStatusPatch(queryClient, variables.organizationId, variables.leadId, {
          deal_status: variables.newStatus,
          lost_reason: variables.newStatus === 'lost' ? variables.lostReason || null : null,
          won_at: variables.newStatus === 'won' ? timestamp : null,
          lost_at: variables.newStatus === 'lost' ? timestamp : null,
          // updated_at remains the server revision used for compare-and-swap.
        });
        state.historyId = `optimistic-status-${variables.leadId}-${++eventSequence}`;
        const event: UnifiedHistoryEvent = { id: state.historyId, type: 'status_change',
          label: `Status: ${statusLabels[state.authorizedLead.deal_status as DealStatus]} -> ${statusLabels[variables.newStatus]}`,
          content: variables.newStatus === 'lost' ? `Motivo: ${variables.lostReason}` : null,
          timestamp, actor: null, source: 'activity', metadata: { from_status: state.authorizedLead.deal_status,
            to_status: variables.newStatus, lost_reason: variables.newStatus === 'lost' ? variables.lostReason : null } };
        queryClient.setQueriesData<UnifiedHistoryEvent[]>({ queryKey: ['lead-history-v2', variables.leadId] },
          (current) => appendOptimisticHistoryEvent(current, event));
        return state;
      } catch (error) { release(state); throw error; }
    },
    mutationFn: async (variables) => {
      const state = pending(queryClient).get(identity(variables));
      if (!state || state.variables !== variables || !state.authorizedLead) throw new LeadStatusPendingError();
      requireCurrent(state);
      try {
        const result = await leadsAPI.updateLead(variables.leadId, {
          deal_status: variables.newStatus,
          lost_reason: variables.newStatus === 'lost' ? lostReasonSchema.parse(variables.lostReason || '') : null,
          expectedUpdatedAt: state.authorizedLead.updated_at,
          ...(variables.propertyId && variables.newStatus === 'won'
            ? { property_id: variables.propertyId, interest_property_id: variables.propertyId } : {}),
        }, variables.organizationId, state.operation.intent);
        if (result.error) throw result.error;
        if (!validLead(result.data as Lead, variables)) throw new LeadStatusOutcomeUncertainError();
        const lead = result.data as Lead;
        return resultFrom(lead, variables);
      } catch (error) {
        if (!uncertainWrite(error)) throw error;
        if (isCurrent(state)) {
          try {
            const read = await leadsAPI.getLead(variables.leadId, variables.organizationId, state.operation.intent.signal, { ...state.operation.intent, retry: false });
            if (isCurrent(state) && !read.error && validLead(read.data as Lead, variables)) {
              const lead = read.data as Lead;
              if (lead.deal_status === variables.newStatus &&
                (variables.newStatus !== 'lost' || lead.lost_reason === variables.lostReason) &&
                (!variables.propertyId || variables.newStatus !== 'won' || lead.property_id === variables.propertyId)) {
                return resultFrom(lead, variables);
              }
              applyScopedLeadStatusPatch(queryClient, variables.organizationId, variables.leadId, canonicalPatch(lead), { authoritative: true });
            }
          } catch { /* The write's completion is still unknown; do not claim rollback. */ }
        }
        throw new LeadStatusOutcomeUncertainError();
      }
    },
    onSuccess: ({ lead, newStatus, financialReviewRequired }, variables, state) => {
      removeOptimisticHistory(queryClient, state);
      if (!state) return;
      if (!canReconcile(state)) {
        invalidateScopedLeadStatus(queryClient, variables.organizationId, variables.leadId, true);
        return;
      }
      // Closing the popup does not retire its authorized cache. A replacement
      // access visit does; only the captured client's scoped data may reconcile.
      rollbackScopedLeadStatusPatch(queryClient, state.rollback);
      applyScopedLeadStatusPatch(queryClient, variables.organizationId, variables.leadId, canonicalPatch(lead), { authoritative: true });
      invalidateScopedLeadStatus(queryClient, variables.organizationId, variables.leadId, !mounted.current);
      invalidateLeadHistorySoon(queryClient, variables.leadId);
      if (!isCurrent(state)) return;
      notifyLeadRealtimeChange({ organizationId: variables.organizationId, leadId: variables.leadId, reason: 'lead.updated' });
      for (const key of ['activities', 'dashboard-stats', 'enhanced-dashboard-stats', 'home', 'properties',
        'properties-infinite', 'property', 'commissions', 'financial-dashboard', 'notifications', 'unread-notifications-count']) {
        void queryClient.invalidateQueries({ queryKey: [key], refetchType: 'active' });
      }
      if (!mounted.current) return;
      const financialReview = state.authorizedLead && getLeadStatusFinancialReviewMessage(state.authorizedLead,
        { deal_status: variables.newStatus, financial_review_required: financialReviewRequired });
      if (financialReview) { toast.warning(financialReview); return; }
      if (newStatus === 'won') toast.success('Negocio fechado!', {
        description: lead.valor_interesse ? formatBRLCurrencyWithDefaultDecimals(lead.valor_interesse) : undefined });
      else toast.info(newStatus === 'lost' ? 'Lead marcado como perdido' : 'Lead reaberto');
    },
    onError: (error, variables, state) => {
      removeOptimisticHistory(queryClient, state);
      if (!(error instanceof LeadStatusPendingError) && !isLeadStatusOutcomeUncertainError(error)) {
        rollbackScopedLeadStatusPatch(queryClient, state?.rollback);
      }
      if (state && !isCurrent(state)) {
        invalidateScopedLeadStatus(queryClient, variables.organizationId, variables.leadId, true);
        void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
        return;
      }
      if (!requestScope.isCurrentVisit() || !mounted.current || scope.current.client !== queryClient || !scope.current.canOperate || error instanceof LeadStatusScopeChangedError) return;
      if (state && !isCurrent(state)) return;
      if (!state && scope.current.organizationId !== variables.organizationId) return;
      if (error instanceof LeadStatusPendingError) { toast.info(error.message); return; }
      invalidateScopedLeadStatus(queryClient, variables.organizationId, variables.leadId, true);
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
      notifyLeadRealtimeChange({ organizationId: variables.organizationId, leadId: variables.leadId, reason: 'lead.updated' });
      if (isLeadStatusOutcomeUncertainError(error)) toast.warning(error.message);
      else toast.error(error.message || 'Erro ao alterar status do negocio');
    },
    onSettled: (_data, _error, variables, state) => {
      release(state);
      requestScope.release(variables);
      if (state && !isCurrent(state)) invalidateScopedLeadStatus(queryClient, variables.organizationId, variables.leadId);
    },
  });
}
