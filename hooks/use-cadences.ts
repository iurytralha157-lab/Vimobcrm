import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cadencesAPI,
  type CadenceTaskTemplate,
  type CadenceTemplate,
  type CreateCadenceTaskInput,
  type UpdateCadenceTaskInput,
} from '@/lib/api/cadences';
import { getStructuredErrorMessage } from '@/lib/api/vimob-error';
import { toast } from 'sonner';

export type { CadenceTaskTemplate, CadenceTemplate, CreateCadenceTaskInput, UpdateCadenceTaskInput };

export function useCadenceTemplates() {
  return useQuery({
    queryKey: ['cadence-templates'],
    queryFn: () => cadencesAPI.listTemplates(),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateCadenceTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: CreateCadenceTaskInput) => cadencesAPI.createTask(task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cadence-templates'] });
      toast.success('Tarefa adicionada!');
    },
    onError: (error) => {
      toast.error('Erro ao adicionar tarefa: ' + getStructuredErrorMessage(error));
    },
  });
}

export function useUpdateCadenceTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: UpdateCadenceTaskInput) => cadencesAPI.updateTask(task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cadence-templates'] });
      toast.success('Tarefa atualizada!');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar tarefa: ' + getStructuredErrorMessage(error));
    },
  });
}

export function useDeleteCadenceTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => cadencesAPI.deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cadence-templates'] });
      toast.success('Tarefa removida!');
    },
    onError: (error) => {
      toast.error('Erro ao remover tarefa: ' + getStructuredErrorMessage(error));
    },
  });
}

export function useSwitchLeadCadence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ leadId, cadenceTemplateId }: { leadId: string; cadenceTemplateId: string }) =>
      cadencesAPI.switchLeadCadence(leadId, cadenceTemplateId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['lead-tasks', result.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', result.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['attention'] });
      toast.success('Cadencia alterada e tarefas recalculadas.');
    },
    onError: (error) => {
      toast.error('Erro ao alterar cadencia: ' + getStructuredErrorMessage(error));
    },
  });
}
