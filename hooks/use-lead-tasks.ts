import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  leadTasksAPI,
  type CompleteCadenceTaskInput,
} from '@/lib/api/lead-tasks';
import type { LeadCadenceState } from '@/lib/validation';
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
  queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
  queryClient.invalidateQueries({ queryKey: ['activities'] });
  queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
  queryClient.invalidateQueries({ queryKey: ['home'] });
  queryClient.invalidateQueries({ queryKey: ['upcoming-tasks'] });
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
    mutationFn: (input: CompleteCadenceTaskInput) => leadTasksAPI.completeCadence(input),
    onMutate: async (input) => {
      const queryKey = ['lead-tasks', input.leadId] as const;
      const historyQueryKey = ['lead-history-v2', input.leadId] as const;
      const cadenceQueryKey = ['lead-cadence-state'] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({ queryKey: historyQueryKey }),
        queryClient.cancelQueries({ queryKey: cadenceQueryKey }),
      ]);
      const previous = queryClient.getQueryData<LeadTask[]>(queryKey) || [];
      const previousHistory = queryClient.getQueryData<UnifiedHistoryEvent[]>(historyQueryKey);
      const previousCadenceStates = queryClient.getQueriesData<LeadCadenceState>({
        queryKey: cadenceQueryKey,
      });
      const now = new Date().toISOString();
      const optimistic = previous.map((task) => {
        if (!input.taskId || task.id !== input.taskId) return task;
        return {
          ...task,
          is_done: true,
          done_at: now,
          outcome: input.outcome || null,
          outcome_notes: input.outcomeNotes || null,
        };
      });
      queryClient.setQueryData(queryKey, optimistic);

      if (input.taskId) {
        previousCadenceStates.forEach(([stateQueryKey, current]) => {
          if (!current || current.lead_id !== input.leadId) return;

          const tasks = current.tasks.map((task) => (
            task.id === input.taskId
              ? {
                  ...task,
                  is_done: true,
                  status: 'completed',
                  done_at: now,
                  outcome: input.outcome || null,
                  outcome_notes: input.outcomeNotes || null,
                }
              : task
          ));
          const pendingTasks = tasks.filter((task) => task.status === 'pending' && !task.is_done);
          const overdue = pendingTasks.filter((task) => (
            task.due_at ? new Date(task.due_at).getTime() < Date.now() : false
          )).length;

          queryClient.setQueryData<LeadCadenceState>(stateQueryKey, {
            ...current,
            tasks,
            summary: {
              ...current.summary,
              completed: tasks.filter((task) => task.status === 'completed' || task.is_done).length,
              pending: pendingTasks.length,
              overdue,
              next_task_id: pendingTasks[0]?.id || null,
            },
          });
        });
      }

      const taskReference = input.taskId || input.templateTaskId || 'unknown';
      queryClient.setQueryData<UnifiedHistoryEvent[]>(historyQueryKey, (current) =>
        appendOptimisticHistoryEvent(current, {
          id: `optimistic-cadence-${input.leadId}-${taskReference}-${now}`,
          type: 'task_completed',
          label: 'Tarefa concluida',
          content: input.title ? `Cadencia concluida: ${input.title}` : 'Tarefa da cadencia concluida',
          timestamp: now,
          actor: null,
          source: 'activity',
          metadata: {
            task_id: input.taskId || null,
            template_task_id: input.templateTaskId || null,
            task_type: input.type || null,
            day_offset: input.dayOffset ?? 0,
            outcome: input.outcome || null,
            outcome_notes: input.outcomeNotes || null,
          },
        }),
      );
      return {
        previous,
        queryKey,
        previousHistory,
        historyQueryKey,
        previousCadenceStates,
      };
    },
    onSuccess: (data) => {
      invalidateLeadTaskCaches(queryClient, data?.lead_id);
    },
    onError: (error, _input, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previous);
        queryClient.setQueryData(context.historyQueryKey, context.previousHistory);
        context.previousCadenceStates.forEach(([queryKey, state]) => {
          queryClient.setQueryData(queryKey, state);
        });
      }
      toast.error('Erro ao completar tarefa: ' + error.message);
    },
  });
}
