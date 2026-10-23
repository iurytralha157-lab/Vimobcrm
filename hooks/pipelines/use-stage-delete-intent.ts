import { useLayoutEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { VimobAPIError } from '@/lib/api/vimob-error';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';

export type DeleteStageData = { id: string; expectedUpdatedAt: string };
const scopeChanged = (kind: 'stage' | 'pipeline') => new VimobAPIError(
  kind === 'pipeline' ? 'O acesso mudou. Reabra a confirmação antes de alterar a pipeline.' : 'O acesso mudou. Reabra a confirmação antes de excluir a coluna.',
  { status: 409, code: kind === 'pipeline' ? 'pipeline_scope_changed' : 'pipeline_delete_scope_changed' });

/** Keep the confirmation's access identity across onMutate waits and refetches. */
export function useStageDeleteIntent(pipelineId?: string) {
  return usePipelineMutationIntent<DeleteStageData>(pipelineId);
}

export function usePipelineMutationIntent<Variables extends object>(pipelineId?: string, kind: 'stage' | 'pipeline' = 'stage') {
  const client = useQueryClient();
  const { activeOrganization, user, profile, session, tenantContext, impersonating } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const actorId = user?.id ?? profile?.id ?? null;
  const sessionId = getGlobalSignOutSessionId(session ?? null);
  const accessKey = JSON.stringify([organizationId, actorId, sessionId, tenantContext, impersonating?.orgId]);
  const access = useMemo(() => ({ client, organizationId, actorId, sessionId, accessKey }),
    [client, organizationId, actorId, sessionId, accessKey]);
  const scope = useMemo(() => ({ ...access, pipelineId }), [access, pipelineId]);
  type Captured = { scope: typeof scope; controller: AbortController; canReconcile: () => boolean };
  const current = useRef<typeof scope | null>(null);
  const lastAccess = useRef(access);
  const operations = useRef(new WeakMap<Variables, Captured>());
  const pending = useRef(new Set<Captured>());
  useLayoutEffect(() => {
    lastAccess.current = access;
    current.current = scope;
    const active = pending.current;
    return () => {
      if (current.current === scope) current.current = null;
      for (const captured of active) if (captured.scope === scope) {
        captured.controller.abort(scopeChanged(kind));
        active.delete(captured);
      }
    };
  }, [scope, access, kind]);
  const isCurrent = (input: Variables) => {
    const captured = operations.current.get(input);
    return Boolean(captured && captured.scope === scope && current.current === scope && !captured.controller.signal.aborted && captured.canReconcile());
  };
  const requireIntent = (input: Variables) => {
    const captured = operations.current.get(input);
    if (!captured || !isCurrent(input) || !organizationId || !actorId || !sessionId) throw scopeChanged(kind);
    return { organizationId, intent: { expectedUserId: actorId, expectedSessionId: sessionId, signal: captured.controller.signal } };
  };
  const capture = (input: Variables) => {
    const clientAccess = captureQueryClientAccess(client);
    if (current.current !== scope || !organizationId || !actorId || !sessionId || !clientAccess()) throw scopeChanged(kind);
    const copy = { ...input };
    const captured = { scope, controller: new AbortController(),
      canReconcile: () => clientAccess() && lastAccess.current === access };
    operations.current.set(copy, captured);
    pending.current.add(captured);
    return copy;
  };
  const discard = (input: Variables) => {
    const captured = operations.current.get(input);
    operations.current.delete(input);
    if (!captured) return;
    pending.current.delete(captured);
    captured.controller.abort(scopeChanged(kind));
  };
  const settled = (input: Variables, preserveConfirmation = true) => {
    const captured = operations.current.get(input);
    if (!captured) return;
    if (captured.canReconcile()) void captured.scope.client.invalidateQueries({
      predicate: query => ['pipelines', 'stages', 'stages-with-leads', ...(kind === 'pipeline' ? ['filtered-stage-counts'] : [])].includes(String(query.queryKey[0])) && query.queryKey[1] === captured.scope.organizationId,
      refetchType: isCurrent(input) ? 'active' : 'none',
    }, { cancelRefetch: false });
    // Keep the original intent until dismissal, including explicit retries of a network failure.
    if (!preserveConfirmation) {
      operations.current.delete(input);
      pending.current.delete(captured);
    }
  };
  const isScopeCurrent = () => current.current === scope && Boolean(organizationId && actorId && sessionId);
  const captureScopeGuard = () => {
    const clientAccess = captureQueryClientAccess(client);
    return () => isScopeCurrent() && clientAccess();
  };
  const captureCallbackGuard = (input: Variables) => {
    const captured = operations.current.get(input);
    return () => Boolean(captured && current.current === captured.scope && !captured.controller.signal.aborted && captured.canReconcile());
  };
  return { capture, discard, isCurrent, isScopeCurrent, captureScopeGuard, captureCallbackGuard, scopeKey: scope, require: requireIntent, settled };
}
