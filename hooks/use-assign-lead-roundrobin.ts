import { useLayoutEffect, useRef } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { toast } from 'sonner';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { invalidateScopedLeadStatus } from '@/lib/pipeline-status-cache';
import type { Lead } from '@/hooks/use-leads';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';

interface AssignLeadResult {
  success: boolean;
  lead_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  assigned_user_id: string | null;
  round_robin_used: boolean;
  error?: string;
}
interface AssignmentScope { organizationId: string; actorId: string | null; leadId: string; operation: LeadRequestOperation }
const requestsByClient = new WeakMap<QueryClient, Map<string, AssignmentScope>>();
function requests(client: QueryClient) {
  let active = requestsByClient.get(client);
  if (!active) { active = new Map(); requestsByClient.set(client, active); }
  return active;
}
function requestKey(organizationId: string, leadId: string) { return JSON.stringify([organizationId, leadId]); }

export function useAssignLeadRoundRobin() {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();
  const auth = useAuth();
  const { hasPermission } = useUserPermissions();
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const organizationId = auth.activeOrganization.organizationId || undefined;
  const actorId = auth.user?.id ?? null;
  const canOperate = hasPermission('lead_operate');
  const scope = useRef({ organizationId, actorId, client: queryClient, canOperate });
  useLayoutEffect(() => { scope.current = { organizationId, actorId, client: queryClient, canOperate }; },
    [organizationId, actorId, queryClient, canOperate]);
  const isCurrent = (context: AssignmentScope) => context.operation.isCurrent() && mounted.current && scope.current.canOperate && scope.current.organizationId === context.organizationId &&
    scope.current.actorId === context.actorId && scope.current.client === queryClient;

  return useMutation<AssignLeadResult, Error, string, AssignmentScope>({
    mutationKey: ['lead-round-robin', organizationId],
    retry: false,
    onMutate: (leadId) => {
      const operation = requestScope.capture();
      if (!organizationId || !scope.current.canOperate || scope.current.organizationId !== organizationId) {
        throw new Error('Não foi possível confirmar seu acesso à organização deste lead.');
      }
      const cached = queryClient.getQueryData<Lead>(['lead', organizationId, leadId]);
      if (cached?.queue_pool) throw new Error('Use Assumir lead no bolsão desta fila.');
      if (cached && (cached.organization_id !== organizationId || cached.can_operate === false)) {
        throw new Error('Você não tem permissão para atribuir este lead.');
      }
      const key = requestKey(organizationId, leadId);
      if (requests(queryClient).has(key)) throw new Error('Já existe uma atribuição deste lead em andamento.');
      const context = { organizationId, leadId, actorId: scope.current.actorId, operation };
      requests(queryClient).set(key, context);
      return context;
    },
    mutationFn: async (leadId) => {
      const context = organizationId ? requests(queryClient).get(requestKey(organizationId, leadId)) : undefined;
      if (!context || !isCurrent(context)) {
        throw new Error('O acesso ao lead mudou. Abra o lead novamente.');
      }
      const result = await leadsAPI.redistributeLeadRoundRobin(leadId, context.organizationId, { expectedUnassigned: true }, context.operation.intent);
      if (result.lead_id !== leadId) throw new Error('Não foi possível confirmar a atribuição deste lead. Atualize os dados.');
      return result;
    },
    onSuccess: (data, _leadId, context) => {
      if (!context) return;
      invalidateScopedLeadStatus(queryClient, context.organizationId, context.leadId, true);
      void queryClient.invalidateQueries({ queryKey: ['stages', context.organizationId] });
      void queryClient.invalidateQueries({ queryKey: ['round-robins', context.organizationId] });
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', context.leadId] });
      if (!isCurrent(context)) return;
      if ((data.success && data.assigned_user_id) || data.error === 'already_assigned') {
        notifyLeadRealtimeChange({ organizationId: context.organizationId, leadId: context.leadId,
          reason: data.error === 'already_assigned' ? 'lead.assigned' : 'lead.redistributed' });
      }
      if (data.error === 'already_assigned') {
        toast.info('Este lead já possui responsável. Os dados do card estão sendo atualizados.');
      } else if (data.success && data.assigned_user_id) {
        toast.success('Lead atribuído pela fila de distribuição.');
      } else if (data.error === 'no_available_members' || data.error === 'no_member') {
        toast.warning('A fila deste lead não encontrou responsável disponível.');
      } else if (data.error === 'no_matching_queue' || data.error === 'no_queue') {
        toast.warning('A fila de origem deste lead não está disponível para distribuição.');
      } else toast.error('Não foi possível atribuir o lead pela fila de origem.');
    },
    onError: (error, leadId, context) => {
      if (!organizationId || !requestScope.isCurrentVisit() || (context && !isCurrent(context)) || scope.current.organizationId !== organizationId) return;
      invalidateScopedLeadStatus(queryClient, organizationId, leadId, true);
      if (error instanceof VimobAPIError && (error.status === 0 || error.status === 408 || error.status >= 500)) {
        notifyLeadRealtimeChange({ organizationId, leadId, reason: 'lead.redistributed' });
        toast.warning('Não foi possível confirmar a atribuição. Os dados estão sendo atualizados; confira o responsável antes de tentar novamente.');
      } else toast.error(error.message);
    },
    onSettled: (_data, _error, leadId, context) => {
      if (context) {
        const key = requestKey(context.organizationId, leadId);
        if (requests(queryClient).get(key) === context) requests(queryClient).delete(key);
      }
    },
  });
}
