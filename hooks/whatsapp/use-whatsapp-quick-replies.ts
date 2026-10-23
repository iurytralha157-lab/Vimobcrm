'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type MutateOptions, type UseQueryResult, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope'
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out'
import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId, type VimobAPIRequestIntent } from '@/lib/api/vimob-client'
import { whatsappQuickRepliesAPI, type QuickReply, type WhatsAppQuickReplyInput } from '@/lib/api/whatsapp-quick-replies'

export type { QuickReply, WhatsAppQuickReplyInput } from '@/lib/api/whatsapp-quick-replies'

/** The UI uses the same identity to retire its personal editor and draft. */
export function useWhatsAppQuickReplyScope() {
  const scope = useWhatsAppQueryScope()
  const { session } = useAuth()
  const sessionId = getGlobalSignOutSessionId(session)
  return useMemo(() => ({ organizationId: scope.organizationId, userId: scope.userId, accessScope: scope.accessScope, sessionId,
    identity: JSON.stringify([scope.organizationId, scope.userId, scope.accessScope, sessionId]),
    enabled: Boolean(scope.organizationId && scope.userId && scope.accessScope && sessionId),
  }), [scope.organizationId, scope.userId, scope.accessScope, sessionId])
}

type Scope = ReturnType<typeof useWhatsAppQuickReplyScope>
const keyFor = (scope: Scope, enabled = true) => ['whatsapp-quick-replies', scope.organizationId, scope.userId, scope.accessScope, scope.sessionId, enabled] as const
const intentFor = (scope: Scope, signal: AbortSignal): VimobAPIRequestIntent => ({
  signal, expectedUserId: scope.userId, expectedSessionId: scope.sessionId,
})

export function useWhatsAppQuickReplies(enabled = true): UseQueryResult<QuickReply[]> {
  const scope = useWhatsAppQuickReplyScope()
  const active = enabled && scope.enabled
  return useQuery({
    queryKey: keyFor(scope, active),
    queryFn: async ({ signal }) => {
      const result = await whatsappQuickRepliesAPI.list(scope.organizationId!, intentFor(scope, signal))
      if (signal.aborted || getVimobAPIAccessTokenUserId() !== scope.userId
        || getVimobAPIAccessTokenSessionId() !== scope.sessionId) throw retiredError()
      return result
    },
    enabled: active, staleTime: 60_000, gcTime: 5 * 60_000, retry: false,
  })
}

type Visit = { owner: object; scope: Scope; client: QueryClient; controller: AbortController; mounted: boolean }
type Operation<Input> = { input: Input; visit: Visit }
const retiredError = () => new DOMException('O contexto da resposta rápida mudou. Abra novamente.', 'AbortError')

/** Bind at the gesture, before React Query schedules its async mutation function. */
function useQuickReplyMutation<Input, Result>(action: (input: Input, organizationId: string, intent: VimobAPIRequestIntent) => Promise<Result>) {
  const scope = useWhatsAppQuickReplyScope()
  const client = useQueryClient()
  const owner = useMemo(() => ({ scope, client }), [scope, client])
  const active = useRef<Visit | null>(null)
  useLayoutEffect(() => {
    active.current?.controller.abort()
    const visit = { owner, scope: owner.scope, client: owner.client, controller: new AbortController(), mounted: true }
    active.current = visit
    // Closing the editor cannot roll back a dispatched write. Let it settle so
    // the exact personal list can reconcile; retire all UI results immediately.
    return () => { visit.mounted = false }
  }, [owner])
  const hasCapturedIdentity = (captured: Visit) => captured.scope.enabled && getVimobAPIAccessTokenUserId() === captured.scope.userId
    && getVimobAPIAccessTokenSessionId() === captured.scope.sessionId
  const isCurrent = (captured: Visit) => active.current === captured && captured.mounted
    && !captured.controller.signal.aborted && hasCapturedIdentity(captured)
  const mutation = useMutation<Result, Error, Operation<Input>>({
    mutationKey: keyFor(scope), retry: false,
    mutationFn: async ({ input, visit: captured }) => {
      if (!isCurrent(captured)) throw retiredError()
      try {
        const result = await action(input, captured.scope.organizationId!, intentFor(captured.scope, captured.controller.signal))
        if (!isCurrent(captured)) throw retiredError()
        return result
      } catch (error) { if (!isCurrent(captured)) throw retiredError(); throw error }
    },
    onSettled: (_result, _error, { visit: captured }) => {
      // Never publish an old mutation payload or replay a write. Only a fresh,
      // scoped GET may update an observer; another actor/SID gets no old read.
      void captured.client.invalidateQueries({ queryKey: keyFor(captured.scope), exact: true,
        refetchType: hasCapturedIdentity(captured) ? 'active' : 'none' })
    },
  })
  const bind = (input: Input) => {
    const visit = active.current
    if (!visit || visit.owner !== owner || !isCurrent(visit)) throw retiredError()
    return { input, visit }
  }
  const callbacks = (operation: Operation<Input>, options?: MutateOptions<Result, Error, Input>): MutateOptions<Result, Error, Operation<Input>> => ({
    onSuccess: (data, _operation, context, mutationContext) => {
      if (isCurrent(operation.visit)) options?.onSuccess?.(data, operation.input, context, mutationContext)
    },
    onError: (error, _operation, context, mutationContext) => {
      if (isCurrent(operation.visit)) options?.onError?.(error, operation.input, context, mutationContext)
    },
    onSettled: (data, error, _operation, context, mutationContext) => {
      if (isCurrent(operation.visit)) options?.onSettled?.(data, error, operation.input, context, mutationContext)
    },
  })
  const currentResult = mutation.variables?.visit.owner === owner && !mutation.variables.visit.controller.signal.aborted
  const mutateAsync = async (input: Input, options?: MutateOptions<Result, Error, Input>) => {
    const operation = bind(input)
    const result = await mutation.mutateAsync(operation, callbacks(operation, options))
    if (!isCurrent(operation.visit)) throw retiredError()
    return result
  }
  return {
    ...mutation,
    ...(!currentResult ? { data: undefined, error: null, context: undefined, failureReason: null, failureCount: 0,
      submittedAt: 0, isPaused: false, status: 'idle' as const, isIdle: true, isPending: false, isError: false, isSuccess: false } : {}),
    variables: currentResult ? mutation.variables?.input : undefined,
    mutate: (input: Input, options?: MutateOptions<Result, Error, Input>) => {
      void mutateAsync(input, options).catch(() => undefined)
    },
    mutateAsync,
  }
}

export function useCreateWhatsAppQuickReply() {
  return useQuickReplyMutation(whatsappQuickRepliesAPI.create)
}
export function useUpdateWhatsAppQuickReply() {
  return useQuickReplyMutation(({ id, ...input }: WhatsAppQuickReplyInput & { id: string }, organizationId, intent) =>
    whatsappQuickRepliesAPI.update(id, input, organizationId, intent))
}
export function useDeleteWhatsAppQuickReply() {
  return useQuickReplyMutation(whatsappQuickRepliesAPI.remove)
}
