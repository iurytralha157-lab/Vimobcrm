import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { leadTasksAPI } from '@/lib/api/lead-tasks';

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
    queryClient.invalidateQueries({ queryKey: ['lead-history-v2', leadId] });
    queryClient.invalidateQueries({ queryKey: ['lead-timeline', leadId] });
  }
}

export function useLeadTasks(leadId?: string) {
  return useQuery({
    queryKey: ['lead-tasks', leadId],
    queryFn: () => (leadId ? leadTasksAPI.list(leadId) : Promise.resolve([])),
    enabled: !!leadId,
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
    onSuccess: (data) => {
      invalidateLeadTaskCaches(queryClient, data?.lead_id);
    },
    onError: (error) => {
      toast.error('Erro ao completar tarefa: ' + error.message);
    },
  });
}
