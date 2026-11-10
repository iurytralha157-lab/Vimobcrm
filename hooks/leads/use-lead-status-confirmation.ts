import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useLeadDetailOperationScope } from '@/hooks/leads/use-lead-detail-operation-scope';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { leadProgressCapability } from '@/lib/lead-operation-capability';
import type { Lead } from '@/hooks/use-leads';

export type LeadLostReasonDraft = { selectedReason: string; details: string };
const emptyDraft = (): LeadLostReasonDraft => ({ selectedReason: '', details: '' });
type ConfirmationMode = 'status' | 'stage';

export type LeadStatusConfirmationIntent = {
  status: 'open' | 'lost';
  authorizedLead: Lead;
  expectedUpdatedAt: string;
  operation: { isCurrent: () => boolean };
};

/** Keep the gesture's authorized read even when a later GET refreshes the lead. */
export function useLeadStatusConfirmation(leadId: string | null, authorizedLead?: Lead | null, accessUnavailable = false) {
  const { activeOrganization, user, session } = useAuth();
  const client = useQueryClient();
  const { hasPermission } = useUserPermissions();
  const sessionId = getGlobalSignOutSessionId(session);
  const hasOperatePermission = hasPermission('lead_operate');
  // Temporary read failures hide/disable the owner without replacing this scope.
  const captureOperation = useLeadDetailOperationScope(leadId, activeOrganization.organizationId,
    user?.id || null, client, hasOperatePermission, sessionId);
  // Visit identity, not a reusable key: A -> B -> A must never revive A's draft.
  const scopeKey = useMemo(() => ({ leadId, organizationId: activeOrganization.organizationId,
    userId: user?.id, sessionId, client, hasOperatePermission }),
  [leadId, activeOrganization.organizationId, user?.id, sessionId, client, hasOperatePermission]);
  const [state, setState] = useState(() => ({ scopeKey, token: {}, intent: null as LeadStatusConfirmationIntent | null, draft: emptyDraft(), mode: 'status' as ConfirmationMode }));
  const active = useRef(state.token);
  const dismissFrame = useRef<typeof scopeKey | null>(scopeKey);
  useLayoutEffect(() => {
    dismissFrame.current = scopeKey;
    return () => { if (dismissFrame.current === scopeKey) dismissFrame.current = null; };
  }, [scopeKey]);
  const accessAvailable = hasOperatePermission && !accessUnavailable;
  const canConfirmStatus = accessAvailable && authorizedLead?.can_operate === true;
  const canConfirmStage = accessAvailable && leadProgressCapability(authorizedLead) === true;
  const latestAccess = useRef({ status: canConfirmStatus, stage: canConfirmStage });
  useLayoutEffect(() => {
    latestAccess.current = { status: canConfirmStatus, stage: canConfirmStage };
  }, [canConfirmStatus, canConfirmStage]);
  const intent = state.scopeKey === scopeKey ? state.intent : null;
  const token = state.scopeKey === scopeKey ? state.token : null;
  const ownsFrame = () => {
    try { return token !== null && active.current === token && captureOperation().isCurrent(); }
    catch { return false; }
  };
  const isCurrent = () => latestAccess.current[state.mode] && ownsFrame();

  const begin = (status: LeadStatusConfirmationIntent['status']) => {
    if ((token !== null && active.current !== token) || !latestAccess.current.status || !authorizedLead || authorizedLead.id !== leadId ||
      authorizedLead.organization_id !== activeOrganization.organizationId ||
      authorizedLead.can_operate !== true || !authorizedLead.updated_at) return null;
    let operation;
    try { operation = captureOperation(); } catch { return null; }
    const next = { status, authorizedLead: { ...authorizedLead },
      expectedUpdatedAt: authorizedLead.updated_at, operation };
    const nextToken = {};
    active.current = nextToken;
    setState({ scopeKey, token: nextToken, intent: next, draft: emptyDraft(), mode: 'status' });
    return next;
  };
  const resolve = (status: LeadStatusConfirmationIntent['status'], candidate = intent) =>
    isCurrent() && candidate && candidate.status === status && candidate === intent && candidate.operation.isCurrent()
      ? candidate : null;
  const restart = () => {
    if ((token !== null && active.current !== token) || !latestAccess.current.stage) return false;
    try { captureOperation(); } catch { return false; }
    const nextToken = {};
    active.current = nextToken;
    setState({ scopeKey, token: nextToken, intent: null, draft: emptyDraft(), mode: 'stage' });
    return true;
  };
  const clear = (candidate?: LeadStatusConfirmationIntent) => {
    // Dismissal never authorizes a write. The current UI may discard a retired
    // permission frame, while callbacks from an older opening remain fenced.
    if (dismissFrame.current !== scopeKey || (token !== null && active.current !== token)
      || (candidate && candidate !== (intent || state.intent))) return false;
    const nextToken = {};
    active.current = nextToken;
    setState({ scopeKey, token: nextToken, intent: null, draft: emptyDraft(), mode: 'status' });
    return true;
  };
  const updateDraft = (draft: LeadLostReasonDraft) => {
    if (isCurrent()) setState(current => current.token === token ? { ...current, draft } : current);
  };
  return { begin, resolve, clear, restart, isCurrent, updateDraft,
    draft: state.scopeKey === scopeKey ? state.draft : emptyDraft() };
}
