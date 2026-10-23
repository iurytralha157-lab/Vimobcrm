'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { captureQueryClientAccess } from '@/lib/access/query-client-access'
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out'
import { VimobAPIError } from '@/lib/api/vimob-error'
import type { UpdateStageOperationalRulesInput } from '@/lib/api/cadences'

const scopeChanged = () => new VimobAPIError('A sessão mudou. Reabra as regras antes de continuar.',
  { code: 'stage_operational_rules_scope_changed', status: 409 })

/** A popup may close while its accepted command still belongs to the provider. */
export function useStageOperationalRulesScope(stageId?: string) {
  const client = useQueryClient()
  const { activeOrganization, user, profile, session, tenantContext, impersonating } = useAuth()
  const organizationId = activeOrganization.organizationId
  const actorId = user?.id ?? profile?.id ?? null
  const sessionId = getGlobalSignOutSessionId(session ?? null)
  const accessKey = JSON.stringify([organizationId, actorId, sessionId, tenantContext, impersonating?.orgId])
  const access = useMemo(() => ({ client, organizationId, actorId, sessionId, accessKey }),
    [client, organizationId, actorId, sessionId, accessKey])
  const scope = useMemo(() => ({ access, stageId }), [access, stageId])
  type Captured = { scope: typeof scope; stageId: string; controller: AbortController; canUseClient: () => boolean }
  const current = useRef<typeof scope | null>(null)
  const operations = useRef(new WeakMap<UpdateStageOperationalRulesInput, Captured>())
  const active = useRef(new Set<Captured>())
  useLayoutEffect(() => {
    current.current = scope
    const pending = active.current
    return () => {
      if (current.current === scope) current.current = null
      for (const operation of pending) if (operation.scope === scope) {
        operation.controller.abort(scopeChanged())
        pending.delete(operation)
      }
    }
  }, [scope])
  const isCurrent = (captured?: Captured) => Boolean(captured && current.current === captured.scope && !captured.controller.signal.aborted && captured.canUseClient())
  const canReconcile = (captured?: Captured) => Boolean(captured?.canUseClient() &&
    (current.current === null || current.current.access === captured.scope.access))
  const begin = (requestedStageId?: string) => {
    if (current.current !== scope || !organizationId || !actorId || !sessionId || !requestedStageId || (stageId && requestedStageId !== stageId)) throw scopeChanged()
    const captured: Captured = { scope, stageId: requestedStageId, controller: new AbortController(), canUseClient: captureQueryClientAccess(client) }
    if (!captured.canUseClient()) throw scopeChanged()
    active.current.add(captured)
    return captured
  }
  const release = (captured: Captured) => { active.current.delete(captured) }
  const intent = (captured: Captured) => ({ expectedUserId: captured.scope.access.actorId,
    expectedSessionId: captured.scope.access.sessionId, signal: captured.controller.signal })
  const capture = (input: UpdateStageOperationalRulesInput) => {
    const copy = structuredClone(input)
    operations.current.set(copy, begin(copy.stage_id))
    return copy
  }
  const requireOperation = (input: UpdateStageOperationalRulesInput) => {
    const captured = operations.current.get(input)
    if (!captured || !isCurrent(captured)) throw scopeChanged()
    return { captured, intent: intent(captured), organizationId: captured.scope.access.organizationId }
  }
  const captureRead = (signal: AbortSignal) => {
    const captured = begin(stageId)
    const abort = () => captured.controller.abort(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    return { captured, intent: intent(captured), finish: () => { signal.removeEventListener('abort', abort); release(captured) } }
  }
  const captureScopeGuard = () => {
    const captured = scope
    const canUseClient = captureQueryClientAccess(client)
    return () => current.current === captured && canUseClient()
  }
  return { client, organizationId, actorId, scopeKey: scope, editorKey: accessKey,
    capture, require: requireOperation, captureRead, isCurrent, canReconcile, captureScopeGuard,
    get: (input: UpdateStageOperationalRulesInput) => operations.current.get(input),
    discard: (input: UpdateStageOperationalRulesInput) => {
      const captured = operations.current.get(input)
      operations.current.delete(input)
      if (captured) release(captured)
    },
    requireReconciliation: (captured: Captured) => { if (!canReconcile(captured)) throw scopeChanged() },
  }
}
