import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cadencesAPI,
  type CadenceTaskTemplate,
  type CadenceTemplate,
  type CreateCadenceTaskInput,
  type UpdateCadenceTaskInput,
} from '@/lib/api/cadences';
import { toast } from 'sonner';

export type { CadenceTaskTemplate, CadenceTemplate, CreateCadenceTaskInput, UpdateCadenceTaskInput };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    const message = asNullableString(error.message);
    const details = asNullableString(error.details);
    const hint = asNullableString(error.hint);
    return [message, details, hint].filter(Boolean).join(' ') || JSON.stringify(error);
  }
  return String(error);
}

export function useCadenceTemplates() {
  return useQuery({
    queryKey: ['cadence-templates'],
    queryFn: () => cadencesAPI.listTemplates(),
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
      toast.error('Erro ao adicionar tarefa: ' + getErrorMessage(error));
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
      toast.error('Erro ao atualizar tarefa: ' + getErrorMessage(error));
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
      toast.error('Erro ao remover tarefa: ' + getErrorMessage(error));
    },
  });
}
