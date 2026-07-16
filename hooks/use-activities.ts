import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@/integrations/supabase/types';
import { activitiesAPI, type Activity } from '@/lib/api/activities';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { appendOptimisticHistoryEvent, invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';

export type { Activity } from '@/lib/api/activities';

function optimisticActivityLabel(type: string) {
  const labels: Record<string, string> = {
    call: 'Ligacao realizada',
    email: 'Email enviado',
    message: 'Mensagem enviada',
    note: 'Nota adicionada',
    task_completed: 'Tarefa concluida',
    contact_updated: 'Contato atualizado',
    proposal_sent: 'Proposta registrada',
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

  return useMutation({
    mutationFn: async (activity: {
      lead_id: string;
      type: string;
      content?: string;
      metadata?: Json;
    }) => activitiesAPI.create(activity),
    onMutate: async (activity) => {
      const queryKey = ['lead-history-v2', activity.lead_id] as const;
      await queryClient.cancelQueries({ queryKey });
      const previousHistory = queryClient.getQueryData<UnifiedHistoryEvent[]>(queryKey);
      const timestamp = new Date().toISOString();
      queryClient.setQueryData<UnifiedHistoryEvent[]>(queryKey, (current) =>
        appendOptimisticHistoryEvent(current, {
          id: `optimistic-activity-${activity.lead_id}-${activity.type}-${timestamp}`,
          type: activity.type,
          label: optimisticActivityLabel(activity.type),
          content: activity.content || null,
          timestamp,
          actor: null,
          source: 'activity',
          metadata: historyMetadata(activity.metadata),
        }),
      );
      return { queryKey, previousHistory };
    },
    onSuccess: (data: Activity) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
      if (data?.lead_id) {
        invalidateLeadHistorySoon(queryClient, data.lead_id);
      }
    },
    onError: (_error, _activity, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previousHistory);
    },
  });
}
