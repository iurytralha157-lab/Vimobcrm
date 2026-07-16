import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { leadTasksAPI } from '@/lib/api/lead-tasks';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { appendOptimisticHistoryEvent, invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';

export type LeadTask = {
  id: string;
  lead_id: string;
  day_offset: number;
  type: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  is_done: boolean | null;
  done_at: string | null;
  done_by: string | null;
  outcome: string | null;
  outcome_notes: string | null;
  created_at: string;
};

function invalidateLeadTaskCaches(queryClient: ReturnType<typeof useQueryClient>, leadId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ['lead-tasks'] });
  queryClient.invalidateQueries({ queryKey: ['activities'] });
  queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
  if (leadId) {
    invalidateLeadHistorySoon(queryClient, leadId);
    queryClient.invalidateQueries({ queryKey: ['lead-timeline', leadId] });
  }
}

export function useLeadTasks(leadId?: string) {
  return useQuery({
    queryKey: ['lead-tasks', leadId],
    queryFn: () => (leadId ? leadTasksAPI.list(leadId) : Promise.resolve([])),
    enabled: !!leadId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useToggleLeadTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, is_done, leadId }: { id: string; is_done: boolean; leadId?: string }) =>
      leadTasksAPI.patch(id, { is_done, leadId }),
    onSuccess: (data) => {
      invalidateLeadTaskCaches(queryClient, data?.lead_id);
    },
    onError: (error) => {
      toast.error('Erro ao atualizar tarefa: ' + error.message);
    },
  });
}

export function useCreateLeadTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: {
      lead_id: string;
      day_offset: number;
      type: 'call' | 'message' | 'email' | 'note';
      title: string;
      description?: string;
      due_date?: string;
    }) => leadTasksAPI.create(task),
    onSuccess: (data) => {
      invalidateLeadTaskCaches(queryClient, data?.lead_id);
      toast.success('Tarefa criada!');
    },
    onError: (error) => {
      toast.error('Erro ao criar tarefa: ' + error.message);
    },
  });
}

export function useCompleteCadenceTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      leadId: string;
      templateTaskId: string;
      dayOffset: number;
      type: 'call' | 'message' | 'email' | 'note';
      title: string;
      description?: string;
      outcome?: string;
      outcomeNotes?: string;
    }) => leadTasksAPI.completeCadence(input),
    onMutate: async (input) => {
      const queryKey = ['lead-tasks', input.leadId] as const;
      const historyQueryKey = ['lead-history-v2', input.leadId] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({ queryKey: historyQueryKey }),
      ]);
      const previous = queryClient.getQueryData<LeadTask[]>(queryKey) || [];
      const previousHistory = queryClient.getQueryData<UnifiedHistoryEvent[]>(historyQueryKey);
      const now = new Date().toISOString();
      let matched = false;
      const optimistic = previous.map((task) => {
        if (task.title !== input.title || task.day_offset !== input.dayOffset || task.type !== input.type) return task;
        matched = true;
        return {
          ...task,
          is_done: true,
          done_at: now,
          outcome: input.outcome || null,
          outcome_notes: input.outcomeNotes || null,
        };
      });
      if (!matched) {
        optimistic.push({
          id: `optimistic-${input.templateTaskId}`,
          lead_id: input.leadId,
          day_offset: input.dayOffset,
          type: input.type,
          title: input.title,
          description: input.description || null,
          due_date: null,
          is_done: true,
          done_at: now,
          done_by: null,
          outcome: input.outcome || null,
          outcome_notes: input.outcomeNotes || null,
          created_at: now,
        });
      }
      queryClient.setQueryData(queryKey, optimistic);
      queryClient.setQueryData<UnifiedHistoryEvent[]>(historyQueryKey, (current) =>
        appendOptimisticHistoryEvent(current, {
          id: `optimistic-cadence-${input.leadId}-${input.templateTaskId}-${now}`,
          type: 'task_completed',
          label: 'Tarefa concluida',
          content: `Cadencia concluida: ${input.title}`,
          timestamp: now,
          actor: null,
          source: 'activity',
          metadata: {
            task_id: `optimistic-${input.templateTaskId}`,
            template_task_id: input.templateTaskId,
            task_type: input.type,
            day_offset: input.dayOffset,
            outcome: input.outcome || null,
            outcome_notes: input.outcomeNotes || null,
          },
        }),
      );
      return { previous, queryKey, previousHistory, historyQueryKey };
    },
    onSuccess: (data) => {
      invalidateLeadTaskCaches(queryClient, data?.lead_id);
    },
    onError: (error, _input, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previous);
        queryClient.setQueryData(context.historyQueryKey, context.previousHistory);
      }
      toast.error('Erro ao completar tarefa: ' + error.message);
    },
  });
}
