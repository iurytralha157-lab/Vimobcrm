'use client'

import { useMutation, type MutateOptions, type MutationKey } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useTenantQueryAccessSignature } from '@/hooks/shared/use-tenant-query-access-signature'
import { usePropertyFormScope } from '@/hooks/properties/use-property-form-scope'
import { capturePropertyMutationIntent } from '@/lib/api/property-mutation-intent'
import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId, type VimobAPIRequestIntent } from '@/lib/api/vimob-client'
import { VimobAPIError } from '@/lib/api/vimob-error'

export type PropertyMutationScope = {
  actorId: string
  organizationId: string
  requestIntent: VimobAPIRequestIntent
  isCurrent: () => boolean
}

type Options<TData, TVariables> = {
  resourceId?: string
  mutationKey?: MutationKey
  getRequestIntent?: (input: TVariables) => VimobAPIRequestIntent | undefined
  mutationFn: (input: TVariables, scope: PropertyMutationScope) => Promise<TData>
  onSuccess?: (data: TData, input: TVariables, scope: PropertyMutationScope) => void | Promise<void>
  onError?: (error: Error, input: TVariables, scope: PropertyMutationScope) => void | Promise<void>
}

/** Capture the gesture before React Query yields; fence transport and callbacks. */
export function usePropertyMutation<TData, TVariables>(options: Options<TData, TVariables>) {
  const { user, activeOrganization, tenantContext } = useAuth()
  const accessSignature = useTenantQueryAccessSignature()
  const { scope, isCurrent } = usePropertyFormScope({
    actorId: user?.id, organizationId: activeOrganization.organizationId,
    resourceId: options.resourceId ?? 'property-command', accessSignature,
  })
  const capture = (input: TVariables) => {
    const originalIntent = options.getRequestIntent?.(input)
    const requestIntent = capturePropertyMutationIntent({
      ...originalIntent,
      expectedUserId: originalIntent?.expectedUserId !== undefined
        ? originalIntent.expectedUserId : scope.actorId ?? null,
    })
    const ready = activeOrganization.status === 'ready'
      && tenantContext?.userId === scope.actorId
      && tenantContext?.organizationId === scope.organizationId
    const current = () => ready && isCurrent(scope)
      && requestIntent.expectedUserId === scope.actorId
      && getVimobAPIAccessTokenUserId() === requestIntent.expectedUserId
      && getVimobAPIAccessTokenSessionId() === requestIntent.expectedSessionId
    const action: PropertyMutationScope = {
      actorId: scope.actorId ?? '', organizationId: scope.organizationId ?? '',
      requestIntent: { ...requestIntent, onRequestStart: () => {
        assertCurrent(action)
        originalIntent?.onRequestStart?.()
        assertCurrent(action)
      } },
      isCurrent: current,
    }
    return { input, action, options }
  }
  type Command = ReturnType<typeof capture>
  const mutation = useMutation<TData, Error, Command>({
    mutationKey: options.mutationKey,
    retry: false,
    mutationFn: async (command) => {
      assertCurrent(command.action)
      const result = await command.options.mutationFn(command.input, command.action)
      assertCurrent(command.action)
      return result
    },
    onSuccess: (data, command) => {
      if (command.action.isCurrent()) return command.options.onSuccess?.(data, command.input, command.action)
    },
    onError: (error, command) => {
      if (command.action.isCurrent()) return command.options.onError?.(error, command.input, command.action)
    },
  })
  const mapOptions = (callbacks?: MutateOptions<TData, Error, TVariables>): MutateOptions<TData, Error, Command> | undefined => callbacks && ({
    onSuccess: (data, command, result, context) => {
      if (command.action.isCurrent()) callbacks.onSuccess?.(data, command.input, result, context)
    },
    onError: (error, command, result, context) => {
      if (command.action.isCurrent()) callbacks.onError?.(error, command.input, result, context)
    },
    onSettled: (data, error, command, result, context) => {
      if (command.action.isCurrent()) callbacks.onSettled?.(data, error, command.input, result, context)
    },
  })
  return {
    ...mutation, variables: mutation.variables?.input,
    mutate: (input: TVariables, callbacks?: MutateOptions<TData, Error, TVariables>) => mutation.mutate(capture(input), mapOptions(callbacks)),
    mutateAsync: async (input: TVariables, callbacks?: MutateOptions<TData, Error, TVariables>) => {
      const command = capture(input)
      const result = await mutation.mutateAsync(command, mapOptions(callbacks))
      assertCurrent(command.action)
      return result
    },
  }
}

function assertCurrent(scope: PropertyMutationScope) {
  if (!scope.isCurrent()) throw new VimobAPIError('A sessão ou o acesso ao imóvel mudou. Reabra a operação antes de continuar.', {
    code: 'property_action_scope_changed', status: 409,
  })
}
