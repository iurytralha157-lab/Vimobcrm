import { useLayoutEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Lead, UpdateLeadInput } from '@/hooks/use-leads';
import type { LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { mergeLeadServerResponse } from '@/lib/merge-lead-server-response';
import { applyScopedLeadStatusPatch } from '@/lib/pipeline-status-cache';
import { invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';

type AccessScope = { organizationId: string | undefined; actorId: string | undefined; client: QueryClient };
export type LeadUpdateContext = AccessScope & { accessScope: AccessScope; leadId: string; operation: LeadRequestOperation };

export function useLeadUpdateCache(client: QueryClient, organizationId: string | undefined, actorId: string | undefined) {
  const scope = useRef<AccessScope>({ organizationId, actorId, client });
  const mounted = useRef(false);
  const operations = useRef(new WeakMap<UpdateLeadInput, LeadUpdateContext>());
  useLayoutEffect(() => { scope.current = { organizationId, actorId, client }; }, [organizationId, actorId, client]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const isCurrent = (context: LeadUpdateContext | undefined) => Boolean(context &&
    mounted.current && scope.current === context.accessScope && context.operation.isCurrent());
  const invalidate = (context: LeadUpdateContext) => {
    const target = context.client;
    void target.invalidateQueries({ queryKey: ['lead', context.organizationId, context.leadId] });
    void target.invalidateQueries({ queryKey: ['leads', context.organizationId] });
    void target.invalidateQueries({ queryKey: ['contacts-list', context.organizationId], refetchType: 'active' });
    void target.invalidateQueries({ queryKey: ['stages-with-leads', context.organizationId], refetchType: 'active' });
    void target.invalidateQueries({ queryKey: ['financial-dashboard', context.organizationId], refetchType: 'active' });
    invalidateLeadHistorySoon(target, context.leadId);
  };

  return {
    onMutate: (variables: UpdateLeadInput, operation: LeadRequestOperation): LeadUpdateContext => {
      const accessScope = scope.current;
      if (!mounted.current || !accessScope.actorId) throw new Error('Usuário não autenticado');
      if (!accessScope.organizationId) throw new Error('Usuário não possui organização');
      if (!operation.isCurrent() || operation.organizationId !== accessScope.organizationId || operation.userId !== accessScope.actorId) {
        throw new Error('Seu acesso mudou. Abra o lead novamente antes de salvar.');
      }
      const context = { ...accessScope, accessScope, leadId: variables.id, operation };
      operations.current.set(variables, context);
      return context;
    },
    requireRequestScope: (variables: UpdateLeadInput) => {
      const context = operations.current.get(variables);
      if (!isCurrent(context) || !context?.organizationId || !context.actorId) {
        throw new Error('Seu acesso mudou. Abra o lead novamente antes de salvar.');
      }
      return { organizationId: context.organizationId, actorId: context.actorId };
    },
    onSuccess: (data: Lead, variables: UpdateLeadInput, context: LeadUpdateContext | undefined) => {
      if (!context) return;
      if (!data?.id || data.id !== context.leadId || (data.organization_id && data.organization_id !== context.organizationId)) {
        invalidate(context);
        return;
      }
      // After close, reconcile the old client's scoped cache. After a change of
      // access, only invalidate it; never patch the newly selected organization.
      if (scope.current !== context.accessScope || !context.operation.canReconcileCapturedAccess()) { invalidate(context); return; }

      client.setQueryData<Lead>(['lead', context.organizationId, data.id], (current) => mergeLeadServerResponse(current, data));
      applyScopedLeadStatusPatch(client, context.organizationId || '', data.id, data, { boardsOnly: true, authoritative: true });
      for (const family of ['leads', 'contacts-list']) {
        client.setQueriesData<Lead[]>({ queryKey: [family, context.organizationId] }, (current) => Array.isArray(current)
          ? current.map((lead) => lead.id === data.id ? mergeLeadServerResponse(lead, data) : lead) : current);
      }
      invalidate(context);
      if (variables.source !== undefined) {
        void client.invalidateQueries({ queryKey: ['shared-filter-lead-meta-filters'] });
        void client.invalidateQueries({ queryKey: ['lead-meta-filters'] });
      }
      if (isCurrent(context)) notifyLeadRealtimeChange({ organizationId: context.organizationId || '', leadId: data.id, reason: 'lead.updated' });
      void client.invalidateQueries({ queryKey: ['activities'], refetchType: 'none' });
    },
    isCurrent,
    contextFor: (variables: UpdateLeadInput) => operations.current.get(variables),
    onError: (context: LeadUpdateContext | undefined) => { if (context) invalidate(context); },
    release: (variables: UpdateLeadInput) => { operations.current.delete(variables); },
  };
}
