'use client'

import { useMutation, useQueryClient, type MutateOptions } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePropertyFormScope } from '@/hooks/properties/use-property-form-scope'
import { stringifyErrorMessage } from '@/lib/api/vimob-error'
import { getVimobAPIAccessTokenUserId, getVimobAPIAccessTokenSessionId } from '@/lib/api/vimob-client'
import { assertPropertyMediaExecution, type PropertyMediaExecutionOptions } from '@/lib/property-media-execution'

type AssetMutationScope = {
  actorId?: string
  organizationId?: string
  tenantUserId?: string | null
  tenantOrganizationId?: string | null
  ready: boolean
  accessSignature: string
  propertyId: string | null
}

/** Capture at the button click, before React Query can await or replace options. */
export function usePropertyAssetMutation<TData, TVariables>(
  source: AssetMutationScope,
  mutationFn: (input: TVariables, organizationId: string, propertyId: string, execution: PropertyMediaExecutionOptions) => Promise<TData>,
  successMessage: string,
) {
  const { scope, isCurrent } = usePropertyFormScope({
    actorId: source.actorId,
    organizationId: source.organizationId,
    resourceId: source.propertyId ?? '',
    accessSignature: `${source.accessSignature}|ready:${source.ready}|tenant-user:${source.tenantUserId}|tenant-org:${source.tenantOrganizationId}`,
  })
  const queryClient = useQueryClient()
  const capture = (input: TVariables) => {
    const valid = Boolean(source.ready && source.actorId && source.organizationId && source.propertyId
      && source.tenantUserId === source.actorId && source.tenantOrganizationId === source.organizationId)
    const expectedSessionId = getVimobAPIAccessTokenSessionId()
    const execution: PropertyMediaExecutionOptions = {
      expectedUserId: scope.actorId,
      expectedSessionId,
      canContinue: () => valid && isCurrent(scope) && getVimobAPIAccessTokenUserId() === scope.actorId
        && getVimobAPIAccessTokenSessionId() === expectedSessionId,
    }
    return {
      input,
      scope,
      organizationId: source.organizationId ?? '',
      propertyId: source.propertyId ?? '',
      accessSignature: source.accessSignature,
      execution,
    }
  }
  type Command = ReturnType<typeof capture>
  const invalidate = (command: Command) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['property-workspace', command.organizationId, command.accessSignature, command.propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['property', command.organizationId, command.propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['property-history', command.organizationId, command.propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['properties', command.organizationId] }),
    queryClient.invalidateQueries({ queryKey: ['properties-infinite', command.organizationId] }),
  ])
  const mutation = useMutation<TData, Error, Command>({
    retry: false,
    mutationFn: async (command) => {
      assertPropertyMediaExecution(command.execution)
      const result = await mutationFn(command.input, command.organizationId, command.propertyId, command.execution)
      assertPropertyMediaExecution(command.execution)
      return result
    },
    onSuccess: async (_data, command) => {
      await invalidate(command)
      if (command.execution.canContinue?.()) toast.success(successMessage)
    },
    onError: async (error, command) => {
      // A response may arrive after scope loss. Refresh only the originating cache.
      await invalidate(command)
      if (command.execution.canContinue?.()) toast.error(stringifyErrorMessage(error))
    },
  })
  const mapOptions = (options?: MutateOptions<TData, Error, TVariables>): MutateOptions<TData, Error, Command> | undefined => options && ({
    onSuccess: (data, command, result, context) => {
      if (command.execution.canContinue?.()) options.onSuccess?.(data, command.input, result, context)
    },
    onError: (error, command, result, context) => {
      if (command.execution.canContinue?.()) options.onError?.(error, command.input, result, context)
    },
    onSettled: (data, error, command, result, context) => {
      if (command.execution.canContinue?.()) options.onSettled?.(data, error, command.input, result, context)
    },
  })
  return {
    ...mutation,
    variables: mutation.variables?.input,
    mutate: (input: TVariables, options?: MutateOptions<TData, Error, TVariables>) => mutation.mutate(capture(input), mapOptions(options)),
    mutateAsync: async (input: TVariables, options?: MutateOptions<TData, Error, TVariables>) => {
      const command = capture(input)
      const result = await mutation.mutateAsync(command, mapOptions(options))
      assertPropertyMediaExecution(command.execution)
      return result
    },
  }
}
