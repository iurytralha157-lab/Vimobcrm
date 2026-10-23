import { useLayoutEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pipelinesAPI } from '@/lib/api/pipelines';
import type { VimobAPIRequestIntent } from '@/lib/api/vimob-client';
import { usePipelineMutationIntent } from '@/hooks/pipelines/use-stage-delete-intent';

export type PipelineDeleteData = { id: string; name: string; expectedRevision: string };
export type PipelineUpdateData = { id: string; expectedRevision: string; name?: string; isDefault?: boolean };
type PipelineCreateData = Parameters<typeof pipelinesAPI.createPipeline>[0];
type StageCreateData = Parameters<typeof pipelinesAPI.createStage>[0];
type StageUpdateData = { id: string } & Parameters<typeof pipelinesAPI.updateStage>[1];
type StagesReorderData = { pipelineId: string; stages: Parameters<typeof pipelinesAPI.reorderStages>[1] };

/** Bind before React Query's first await, including its global onMutate. */
function useScopedPipelineMutation<Variables extends object, Result>(
  execute: (variables: Variables, organizationId: string, intent: VimobAPIRequestIntent) => Promise<Result>,
  snapshot: (variables: Variables) => Variables = variables => ({ ...variables }),
) {
  const scope = usePipelineMutationIntent<Variables>(undefined, 'pipeline');
  const mutation = useMutation({
    mutationFn: async (variables: Variables) => {
      const operation = scope.require(variables);
      try {
        const result = await execute(variables, operation.organizationId, operation.intent);
        scope.require(variables);
        return result;
      } catch (error) {
        scope.require(variables);
        throw error;
      }
    },
    retry: false,
    onSettled: (_data, _error, variables) => scope.settled(variables, false),
  });
  const reset = mutation.reset;
  // Retire only this observer; an accepted old command still reconciles its owner.
  useLayoutEffect(() => reset(), [scope.scopeKey, reset]);
  const guardedOptions = (variables: Variables, options?: Parameters<typeof mutation.mutate>[1]) => {
    const isCurrent = scope.captureCallbackGuard(variables);
    const guarded: NonNullable<typeof options> = {
      onSuccess: (...args) => { if (isCurrent()) options?.onSuccess?.(...args); },
      onError: (...args) => { if (isCurrent()) options?.onError?.(...args); },
      onSettled: (...args) => { if (isCurrent()) options?.onSettled?.(...args); },
    };
    return guarded;
  };
  return { ...mutation, scopeKey: scope.scopeKey, isScopeCurrent: scope.isScopeCurrent, captureScopeGuard: scope.captureScopeGuard,
    mutate: (variables: Variables, options?: Parameters<typeof mutation.mutate>[1]) => {
      const captured = scope.capture(snapshot(variables));
      mutation.mutate(captured, guardedOptions(captured, options));
    },
    mutateAsync: (variables: Variables, options?: Parameters<typeof mutation.mutateAsync>[1]) => {
      const captured = scope.capture(snapshot(variables));
      return mutation.mutateAsync(captured, guardedOptions(captured, options));
    },
  };
}

export function usePipelineCreateMutation() {
  return useScopedPipelineMutation(async (variables: PipelineCreateData, organizationId, intent) => {
    const result = await pipelinesAPI.createPipeline({ ...variables, isDefault: variables.isDefault ?? false }, organizationId, intent);
    if (result.organization_id !== organizationId) throw new Error('A resposta não corresponde à organização solicitada.');
    return result;
  });
}

export function useStageCreateMutation() {
  return useScopedPipelineMutation(async (variables: StageCreateData, organizationId, intent) => {
    const result = await pipelinesAPI.createStage(variables, organizationId, intent);
    if (result.organization_id !== organizationId || result.pipeline_id !== variables.pipelineId) throw new Error('A resposta não corresponde à coluna solicitada.');
    return result;
  });
}

export function useStageUpdateMutation() {
  return useScopedPipelineMutation(async (variables: StageUpdateData, organizationId, intent) => {
    const { id, ...input } = variables;
    const result = await pipelinesAPI.updateStage(id, input, organizationId, intent);
    if (result.id !== id || result.organization_id !== organizationId) throw new Error('A resposta não corresponde à coluna solicitada.');
    return result;
  });
}

export function useStagesReorderMutation() {
  return useScopedPipelineMutation(async (variables: StagesReorderData, organizationId, intent) => {
    const result = await pipelinesAPI.reorderStages(variables.pipelineId, variables.stages, organizationId, intent);
    const returnedIds = new Set(result.map(stage => stage.id));
    if (returnedIds.size !== result.length ||
      variables.stages.some(stage => !returnedIds.has(stage.id)) ||
      result.some(stage => stage.organization_id !== organizationId || stage.pipeline_id !== variables.pipelineId)) {
      throw new Error('A resposta não corresponde às colunas solicitadas.');
    }
    return result;
  }, variables => ({ ...variables, stages: variables.stages.map(stage => ({ ...stage })) }));
}

export function usePipelineUpdateMutation() {
  const scope = usePipelineMutationIntent<PipelineUpdateData>(undefined, 'pipeline');
  const mutation = useMutation({
    mutationFn: async (variables: PipelineUpdateData) => {
      const operation = scope.require(variables);
      const { id, ...input } = variables;
      const result = await pipelinesAPI.updatePipeline(id, input, operation.organizationId, operation.intent);
      scope.require(variables);
      if (result.id !== id || result.organization_id !== operation.organizationId) throw new Error('A resposta não corresponde à pipeline solicitada.');
      return result;
    },
    retry: false,
    onSettled: (_data, _error, variables) => scope.settled(variables, false),
  });
  return { ...mutation,
    mutate: (variables: PipelineUpdateData, options?: Parameters<typeof mutation.mutate>[1]) => mutation.mutate(scope.capture(variables), options),
    mutateAsync: (variables: PipelineUpdateData, options?: Parameters<typeof mutation.mutateAsync>[1]) => mutation.mutateAsync(scope.capture(variables), options),
  };
}

export function usePipelineDeleteMutation() {
  const scope = usePipelineMutationIntent<PipelineDeleteData>(undefined, 'pipeline');
  const mutation = useMutation({
    mutationFn: async (variables: PipelineDeleteData) => {
      const operation = scope.require(variables);
      await pipelinesAPI.deletePipeline(variables.id, variables.expectedRevision, operation.organizationId, operation.intent);
      scope.require(variables);
    },
    retry: false,
    onSettled: (_data, _error, variables) => scope.settled(variables),
  });
  // Capture when the confirmation opens, never when its old callback is invoked.
  return { ...mutation, capture: scope.capture, discard: scope.discard, isCurrent: scope.isCurrent, isScopeCurrent: scope.isScopeCurrent };
}
