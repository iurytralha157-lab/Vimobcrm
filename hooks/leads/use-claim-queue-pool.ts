'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { leadsAPI } from '@/lib/api/leads';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { createUUID } from '@/lib/client-id';
import { canClaimQueuePool, type QueuePoolLead } from '@/lib/queue-pool';
import { queuePoolClaimAttemptKey, reserveQueuePoolClaimAttempt } from '@/lib/queue-pool-claim-attempt';
import { applyScopedLeadStatusPatch, invalidateScopedLeadStatus } from '@/lib/pipeline-status-cache';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { toast } from 'sonner';
import type { Lead } from '@/hooks/use-leads';
import { hasCachedQueuePoolClaim, queuePoolAccessVersion } from '@/lib/queue-pool-cache';

type Variables = { lead: QueuePoolLead };
type Context = { operation: LeadRequestOperation; key: string; idempotencyKey: string; accessVersion: number };
const stateByClient = new WeakMap<QueryClient, { attempts: Map<string, string>; active: Set<string> }>();
function clientState(client: QueryClient) {
  let state = stateByClient.get(client);
  if (!state) { state = { attempts: new Map(), active: new Set() }; stateByClient.set(client, state); }
  return state;
}

export function useClaimQueuePool() {
  const client = useQueryClient();
  const scope = useLeadRequestScope();
  const contexts = useRef(new WeakMap<Variables, Context>());
  const isCurrent = (context: Context) => context.operation.isCurrent() && context.accessVersion === queuePoolAccessVersion(client, context.operation.organizationId);
  return useMutation<Lead, Error, Variables, Context>({
    mutationKey: ['lead-queue-pool-claim'], retry: false,
    onMutate: (variables) => {
      const operation = scope.bind(variables);
      const lead = variables.lead;
      if (lead.organization_id !== operation.organizationId || !canClaimQueuePool(lead) || !hasCachedQueuePoolClaim(client, operation.organizationId, lead)) throw new Error('Este lead não está disponível para você assumir. Atualize os dados.');
      const key = queuePoolClaimAttemptKey(operation.organizationId, operation.userId, operation.sessionId, lead);
      const state = clientState(client);
      if (state.active.has(key)) throw new Error('Este lead já está sendo assumido.');
      const idempotencyKey = reserveQueuePoolClaimAttempt(state.attempts, key, createUUID);
      state.active.add(key);
      const context = { operation, key, idempotencyKey, accessVersion: queuePoolAccessVersion(client, operation.organizationId) };
      contexts.current.set(variables, context);
      return context;
    },
    mutationFn: async (variables) => {
      const context = contexts.current.get(variables);
      if (!context || !isCurrent(context)) throw new Error('Seu acesso mudou. Abra o lead novamente.');
      const pool = variables.lead.queue_pool!;
      const result = await leadsAPI.claimQueuePool(variables.lead.id, {
        roundRobinId: pool.round_robin_id, episodeId: pool.episode_id, expectedRevision: pool.revision,
      }, context.idempotencyKey, context.operation.organizationId, context.operation.intent);
      if (result.data.assigned_user_id !== context.operation.userId) throw new Error('Não foi possível confirmar quem assumiu este lead. Atualize os dados.');
      return result.data as Lead;
    },
    onSuccess: (lead, variables, context) => {
      clientState(client).attempts.delete(context.key);
      if (context.operation.canReconcileCapturedAccess()) invalidateScopedLeadStatus(client, context.operation.organizationId, variables.lead.id, true);
      if (!isCurrent(context)) return;
      applyScopedLeadStatusPatch(client, context.operation.organizationId, variables.lead.id, lead, { authoritative: true });
      invalidateScopedLeadStatus(client, context.operation.organizationId, variables.lead.id, true);
      notifyLeadRealtimeChange({ organizationId: context.operation.organizationId, leadId: variables.lead.id, reason: 'lead.assigned' });
      toast.success('Lead assumido por você.');
    },
    onError: (error, variables, context) => {
      const operation = context?.operation ?? scope.contextFor(variables);
      if (context && error instanceof VimobAPIError && error.status > 0 && error.status < 500 && error.status !== 408 && error.status !== 429) clientState(client).attempts.delete(context.key);
      if (!operation?.isCurrent() || (context && !isCurrent(context))) return;
      invalidateScopedLeadStatus(client, operation.organizationId, variables.lead.id, true);
      if (error instanceof VimobAPIError && error.status === 409) toast.info('O bolsão mudou ou este lead já foi assumido. Os dados estão sendo atualizados.');
      else if (error instanceof VimobAPIError && (error.status === 0 || error.status === 408 || error.status >= 500)) toast.warning('Não foi possível confirmar o resultado. Confira o responsável; uma nova tentativa desta mesma ação preservará sua identificação.');
      else toast.error(error.message);
    },
    onSettled: (_lead, _error, variables, context) => {
      if (context) clientState(client).active.delete(context.key);
      scope.release(variables);
    },
  });
}
