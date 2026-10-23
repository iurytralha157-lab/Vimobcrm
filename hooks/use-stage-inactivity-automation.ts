'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out'
import { stageConfigAPI } from '@/lib/api/stage-config'
import { VimobAPIError } from '@/lib/api/vimob-error'
import type { StageInactivityCreateInput, StageInactivityUpdateInput } from '@/lib/validation/stage-inactivity'
import { toast } from 'sonner'

type SaveInactivity =
  | { input: StageInactivityCreateInput; id?: undefined; runtimeAvailable?: boolean }
  | { input: StageInactivityUpdateInput; id: string; runtimeAvailable: boolean }

type Scope = { client: ReturnType<typeof useQueryClient>; scopeKey: string; stageId: string; organizationId: string | null; actorId: string | null; sessionId: string | null }
type MutationScope = { scope: Scope; controller: AbortController }
const scopeChanged = () => new VimobAPIError('A sessão mudou. Reabra a configuração antes de continuar.', { code: 'inactivity_scope_changed', status: 409 })

export function useStageInactivityAutomation(stageId: string) {
  const client = useQueryClient()
  const { activeOrganization, user, profile, session, tenantContext, impersonating } = useAuth()
  const organizationId = activeOrganization.organizationId
  const actorId = user?.id ?? profile?.id ?? null
  const sessionId = getGlobalSignOutSessionId(session ?? null)
  const scopeKey = JSON.stringify([stageId, organizationId, actorId, sessionId, tenantContext, impersonating?.orgId])
  // Object identity distinguishes A -> B -> A from the original visit to A.
  const scope = useMemo<Scope>(() => ({ client, scopeKey, stageId, organizationId, actorId, sessionId }), [client, scopeKey, stageId, organizationId, actorId, sessionId])
  const currentScope = useRef<Scope | null>(null)
  const operationScopes = useRef(new WeakMap<SaveInactivity, MutationScope>())
  const activeOperations = useRef(new Set<MutationScope>())
  useLayoutEffect(() => {
    currentScope.current = scope
    const operations = activeOperations.current
    return () => {
      currentScope.current = null
      for (const operation of operations) {
        if (operation.scope !== scope) continue
        operation.controller.abort(scopeChanged())
        operations.delete(operation)
      }
    }
  }, [scope])

  const isCurrent = (captured: MutationScope) => currentScope.current === captured.scope && !captured.controller.signal.aborted
  const mutation = useMutation({
    onMutate: (variables: SaveInactivity) => operationScopes.current.get(variables),
    mutationFn: async (variables: SaveInactivity) => {
      const { input, runtimeAvailable } = variables
      const captured = operationScopes.current.get(variables)
      if (!captured?.scope.organizationId || !captured.scope.actorId || !captured.scope.sessionId || !isCurrent(captured)) throw scopeChanged()
      if (variables.id === undefined && variables.input.stage_id !== captured.scope.stageId) throw scopeChanged()
      if (input.is_enabled && runtimeAvailable !== true) {
        throw new VimobAPIError('Os alertas de inatividade estão indisponíveis. A regra permanece desativada.', { code: 'inactivity_runtime_unavailable', status: 503 })
      }
      const intent = { expectedUserId: captured.scope.actorId, expectedSessionId: captured.scope.sessionId, signal: captured.controller.signal }
      const result = variables.id !== undefined
        ? await stageConfigAPI.updateStageInactivityAutomation(variables.id, variables.input, captured.scope.organizationId, intent)
        : await stageConfigAPI.createStageInactivityAutomation(variables.input, captured.scope.organizationId, intent)
      if (!isCurrent(captured)) throw scopeChanged()
      if (result.organization_id !== captured.scope.organizationId || result.stage_id !== captured.scope.stageId || (variables.id && result.id !== variables.id)) {
        throw new VimobAPIError('A resposta não corresponde à configuração solicitada.', { code: 'inactivity_response_scope_mismatch', status: 409 })
      }
      return result
    },
    onSuccess: (result, _, captured) => {
      if (!captured || !isCurrent(captured)) return
      const policy = result.inactivity_policy
      toast.success(policy?.effective_enabled === true ? 'Alerta de inatividade ativado' : policy?.is_enabled === true ? 'Regra salva; os alertas estão indisponíveis' : 'Regra de inatividade salva desativada')
    },
    onSettled: (_, __, variables, captured) => {
      captured = captured ?? operationScopes.current.get(variables)
      operationScopes.current.delete(variables)
      if (!captured) return
      activeOperations.current.delete(captured)
      void captured.scope.client.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'stage-automations' && query.queryKey[2] === captured.scope.organizationId && query.queryKey[3] === captured.scope.actorId,
        refetchType: isCurrent(captured) ? 'active' : 'none',
      })
    },
  })
  const capture = (variables: SaveInactivity): SaveInactivity => {
    // Capture before React Query can await a global onMutate callback.
    const copy = variables.id !== undefined
      ? { ...variables, input: { ...variables.input } }
      : { ...variables, input: { ...variables.input } }
    const captured = { scope, controller: new AbortController() }
    operationScopes.current.set(copy, captured)
    activeOperations.current.add(captured)
    return copy
  }
  return {
    ...mutation, scopeKey,
    mutate: (variables: SaveInactivity, options?: Parameters<typeof mutation.mutate>[1]) => mutation.mutate(capture(variables), options),
    mutateAsync: (variables: SaveInactivity, options?: Parameters<typeof mutation.mutateAsync>[1]) => mutation.mutateAsync(capture(variables), options),
  }
}
