import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { pipelinesAPI } from '@/lib/api/pipelines';
import type { z } from 'zod';
import type { pipelineRoundRobinInputSchema } from '@/lib/validation/pipelines';
import { getStructuredErrorMessage, VimobAPIError } from '@/lib/api/vimob-error';
import { usePipelineMutationIntent } from '@/hooks/pipelines/use-stage-delete-intent';

export type UpdatePipelineRoundRobinData = { pipelineId: string } & z.infer<typeof pipelineRoundRobinInputSchema>;

export function useUpdatePipelineRoundRobin() {
  const scope = usePipelineMutationIntent<UpdatePipelineRoundRobinData>(undefined, 'pipeline');
  const mutation = useMutation({
    mutationFn: async (variables: UpdatePipelineRoundRobinData) => {
      const operation = scope.require(variables);
      const result = await pipelinesAPI.setPipelineRoundRobin(variables.pipelineId, variables.roundRobinId,
        variables.expectedRevision, operation.organizationId, operation.intent);
      scope.require(variables);
      if (result.id !== variables.pipelineId || result.organization_id !== operation.organizationId) {
        throw new Error('A resposta não corresponde à pipeline solicitada.');
      }
      return result;
    },
    retry: false,
    onSuccess: (_data, variables) => {
      if (scope.isCurrent(variables)) toast.success('Fila padrão atualizada!');
    },
    onError: (error: Error, variables) => {
      if (!scope.isCurrent(variables)) return;
      toast.error(error instanceof VimobAPIError && error.code === 'pipeline_changed'
        ? 'Este funil foi atualizado em outra sessão. Confira os dados e selecione a fila novamente.'
        : getStructuredErrorMessage(error) || 'Não foi possível atualizar a fila padrão.');
    },
    onSettled: (_data, _error, variables) => scope.settled(variables, false),
  });
  return { ...mutation, isScopeCurrent: scope.isScopeCurrent,
    mutate: (variables: UpdatePipelineRoundRobinData, options?: Parameters<typeof mutation.mutate>[1]) => mutation.mutate(scope.capture(variables), options),
    mutateAsync: async (variables: UpdatePipelineRoundRobinData, options?: Parameters<typeof mutation.mutateAsync>[1]) => mutation.mutateAsync(scope.capture(variables), options),
  };
}
