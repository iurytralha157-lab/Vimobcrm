import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@/lib/supabase/types';
import { activitiesAPI, type Activity } from '@/lib/api/activities';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { appendOptimisticLeadHistoryEvent, removeOptimisticLeadHistoryEvent, invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';
import { manualActivityCreateInputSchema, type ManualActivityCreateInput } from '@/lib/validation/manual-activities';
import { parseDomainInput } from '@/lib/validation/common';

export type { Activity } from '@/lib/api/activities';
let optimisticActivitySequence = 0;
const manualActivityInputs = new WeakMap<LeadRequestOperation, Readonly<ManualActivityCreateInput>>();

function optimisticActivityLabel(type: string) {
  const labels: Record<string, string> = {
    call: 'Ligacao realizada',
    call_initiated: 'Ligação iniciada',
    email: 'Email enviado',
    message: 'Mensagem enviada',
    note: 'Nota adicionada',
  };
  return labels[type] || 'Historico atualizado';
}

function historyMetadata(metadata?: Json): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

export function useActivities(leadId?: string) {
  return useQuery({
    queryKey: ['activities', leadId],
    queryFn: async () => activitiesAPI.list({ leadId, limit: leadId ? 500 : 100 }),
  });
}

export function useRecentActivities() {
  return useQuery({
    queryKey: ['recent-activities'],
    queryFn: async () => activitiesAPI.list({ limit: 10 }),
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();

  return useMutation({
    mutationFn: async (activity: {
      lead_id: string;
      type: string;
      content?: string | null;
      metadata?: Json;
    }) => {
      const operation = requestScope.require(activity);
      const captured = manualActivityInputs.get(operation);
      if (!captured) throw new Error('A tentativa de registro não está mais disponível.');
      return activitiesAPI.create(captured, operation.organizationId, operation.intent);
    },
    onMutate: async (activity) => {
      // Validate and freeze the flat payload before cancellation yields. A
      // caller cannot replace its type/metadata during an async cache read.
      const validated = parseDomainInput(manualActivityCreateInputSchema, activity, 'activities.create');
      const captured = Object.freeze({ ...validated, metadata: Object.freeze({ ...validated.metadata }) });
      const operation = requestScope.bind(activity);
      manualActivityInputs.set(operation, captured);
      const queryKey = ['lead-history-v2', captured.lead_id] as const;
      await queryClient.cancelQueries({ queryKey });
      requestScope.require(activity);
      const timestamp = new Date().toISOString();
      const optimisticHistoryId = appendOptimisticLeadHistoryEvent(queryClient, captured.lead_id, {
          id: `optimistic-activity-${captured.lead_id}-${captured.type}-${timestamp}-${++optimisticActivitySequence}`,
          type: captured.type,
          label: optimisticActivityLabel(captured.type),
          content: captured.content,
          timestamp,
          actor: null,
          source: 'activity',
          metadata: { ...historyMetadata(captured.metadata), origin: 'manual_activity' },
        });
      return { leadId: captured.lead_id, optimisticHistoryId, operation };
    },
    onSuccess: (data: Activity) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
      if (data?.lead_id) {
        invalidateLeadHistorySoon(queryClient, data.lead_id);
      }
    },
    onError: (_error, _activity, context) => {
      if (context) removeOptimisticLeadHistoryEvent(queryClient, context.leadId, context.optimisticHistoryId);
    },
    onSettled: (_data, _error, variables) => {
      const operation = requestScope.contextFor(variables);
      if (operation) manualActivityInputs.delete(operation);
      requestScope.release(variables);
    },
  });
}
