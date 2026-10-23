import { useLayoutEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { VimobAPIError } from '@/lib/api/vimob-error';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';

const scopeChanged = () => new VimobAPIError('A sessão mudou. Reabra a configuração antes de continuar.',
  { code: 'stage_automation_scope_changed', status: 409 });

/** Capture the initiating actor/SID before React Query can await onMutate. */
export function useStageAutomationMutationScope<Variables extends object>() {
  const client = useQueryClient();
  const { activeOrganization, user, profile, session, tenantContext, impersonating } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const actorId = user?.id ?? profile?.id ?? null;
  const sessionId = getGlobalSignOutSessionId(session ?? null);
  const accessKey = JSON.stringify([organizationId, actorId, sessionId, tenantContext, impersonating?.orgId]);
  const scope = useMemo(() => ({ client, organizationId, actorId, sessionId, accessKey }),
    [client, organizationId, actorId, sessionId, accessKey]);
  type Captured = { scope: typeof scope; controller: AbortController; canUseClient: () => boolean };
  const current = useRef<typeof scope | null>(null);
  const operations = useRef(new WeakMap<Variables, Captured>());
  const active = useRef(new Set<Captured>());
  useLayoutEffect(() => {
    current.current = scope;
    const pending = active.current;
    return () => {
      if (current.current === scope) current.current = null;
      for (const operation of pending) if (operation.scope === scope) {
        operation.controller.abort(scopeChanged());
        pending.delete(operation);
      }
    };
  }, [scope]);
  const isCurrent = (captured?: Captured) => Boolean(captured && current.current === captured.scope && !captured.controller.signal.aborted);
  const capture = (variables: Variables) => {
    if (current.current !== scope || !organizationId || !actorId || !sessionId) throw scopeChanged();
    const copy = { ...variables };
    const captured = { scope, controller: new AbortController(), canUseClient: captureQueryClientAccess(client) };
    operations.current.set(copy, captured);
    active.current.add(captured);
    return copy;
  };
  const requireOperation = (variables: Variables) => {
    const captured = operations.current.get(variables);
    if (!captured || !isCurrent(captured) || !captured.scope.organizationId || !captured.scope.actorId || !captured.scope.sessionId) throw scopeChanged();
    return { captured, organizationId: captured.scope.organizationId,
      intent: { expectedUserId: captured.scope.actorId, expectedSessionId: captured.scope.sessionId, signal: captured.controller.signal } };
  };
  const discard = (variables: Variables) => {
    const captured = operations.current.get(variables);
    operations.current.delete(variables);
    if (!captured) return;
    active.current.delete(captured);
    captured.controller.abort(scopeChanged());
  };
  const settled = (variables: Variables, preserveConfirmation = false) => {
    const captured = operations.current.get(variables);
    if (!captured) return;
    if (!preserveConfirmation) {
      operations.current.delete(variables);
      active.current.delete(captured);
    }
    void captured.scope.client.invalidateQueries({
      predicate: query => query.queryKey[0] === 'stage-automations' && query.queryKey[2] === captured.scope.organizationId && query.queryKey[3] === captured.scope.actorId,
      refetchType: isCurrent(captured) ? 'active' : 'none',
    });
  };
  // A normal editor close may reconcile its accepted command without refetch.
  // An expired provider visit must never touch that client's cache again.
  const settledForCurrentAccess = (variables: Variables) => {
    const captured = operations.current.get(variables);
    if (captured?.canUseClient()) settled(variables);
    else discard(variables);
  };
  const captureScopeGuard = () => {
    const captured = scope;
    const canUseClient = captureQueryClientAccess(client);
    return () => current.current === captured && canUseClient();
  };
  return { capture, discard, require: requireOperation, isCurrent, settled, settledForCurrentAccess,
    scopeKey: scope, captureScopeGuard, get: (variables: Variables) => operations.current.get(variables) };
}
