import { useLayoutEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { captureLeadRequestIntent } from '@/lib/lead-request-intent';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';
import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId, type VimobAPIRequestIntent } from '@/lib/api/vimob-client';

export type LeadRequestOperation = {
  organizationId: string;
  userId: string;
  sessionId: string;
  intent: VimobAPIRequestIntent;
  isCurrent: () => boolean;
  canReconcileCapturedAccess: () => boolean;
};

/** Bind a gesture before its first await. Token refresh within the same SID survives. */
export function useLeadRequestScope() {
  const { activeOrganization, user, session } = useAuth();
  const client = useQueryClient();
  const organizationId = activeOrganization.organizationId;
  const userId = user?.id;
  const sessionId = getGlobalSignOutSessionId(session);
  // A -> B -> A creates a different visit even when the final key is identical.
  const identity = useMemo(() => ({ organizationId, userId, sessionId, client }),
    [organizationId, userId, sessionId, client]);
  const lastIdentity = useRef(identity);
  const active = useRef<{ identity: typeof identity; controller: AbortController } | null>(null);
  const operations = useRef(new WeakMap<object, LeadRequestOperation>());
  useLayoutEffect(() => {
    lastIdentity.current = identity;
    const visit = { identity, controller: new AbortController() };
    active.current = visit;
    return () => {
      visit.controller.abort();
      if (active.current === visit) active.current = null;
    };
  }, [identity]);

  const capture = (): LeadRequestOperation => {
    const visit = active.current;
    const canReconcileClientAccess = captureQueryClientAccess(client);
    if (!visit || visit.identity !== identity || !organizationId || !canReconcileClientAccess()) {
      throw new Error('Seu acesso mudou. Abra o contato novamente antes de continuar.');
    }
    const intent = Object.freeze({ ...captureLeadRequestIntent(userId, sessionId), signal: visit.controller.signal });
    // A normal close may reconcile its old client; an observed replacement visit never revives.
    const canReconcileCapturedAccess = () => canReconcileClientAccess() && lastIdentity.current === identity
      && getVimobAPIAccessTokenUserId() === userId && getVimobAPIAccessTokenSessionId() === sessionId;
    return {
      organizationId, userId: userId!, sessionId: sessionId!, intent, canReconcileCapturedAccess,
      isCurrent: () => active.current === visit && !visit.controller.signal.aborted && canReconcileCapturedAccess(),
    };
  };
  const bind = (variables: object) => {
    const operation = capture();
    operations.current.set(variables, operation);
    return operation;
  };
  const requireOperation = (variables: object) => {
    const operation = operations.current.get(variables);
    if (!operation?.isCurrent()) throw new Error('Seu acesso mudou. Abra o contato novamente antes de continuar.');
    return operation;
  };
  return {
    capture, bind, require: requireOperation,
    isCurrentVisit: () => active.current?.identity === identity && !active.current.controller.signal.aborted
      && getVimobAPIAccessTokenUserId() === userId && getVimobAPIAccessTokenSessionId() === sessionId,
    contextFor: (variables: object) => operations.current.get(variables),
    release: (variables: object) => operations.current.delete(variables),
    isCurrent: (operation?: LeadRequestOperation | null) => operation?.isCurrent() === true,
  };
}
