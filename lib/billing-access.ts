export type BillingAccessState = {
  subscription_status?: unknown;
  subscription_type?: unknown;
  trial_ends_at?: unknown;
  billing_grace_until?: unknown;
};

export type BillingPlanPromotionState = {
  subscription_status?: unknown;
  plan_id?: unknown;
  pending_plan_id?: unknown;
};

function normalizeBillingValue(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function deadlineIsInFuture(value: unknown, now: number) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now < timestamp;
}

export function hasBillingAccess(
  state: BillingAccessState | null | undefined,
  now = Date.now(),
) {
  if (!state || !Number.isFinite(now)) return false;

  const rawType = state.subscription_type;
  const status = normalizeBillingValue(state.subscription_status);
  const type = normalizeBillingValue(rawType);
  const legacyTypeIsMissing = (
    rawType === undefined
    || rawType === null
    || (typeof rawType === 'string' && rawType.trim() === '')
  );

  // Compatibility with API versions that only returned subscription_status.
  // Missing or explicitly blocked statuses remain closed; only the two legacy
  // access states are accepted until the complete billing context is available.
  if (legacyTypeIsMissing) return status === 'active' || status === 'trial';
  if (typeof rawType !== 'string') return false;

  if (type === 'free') return status === 'active';
  if (type === 'trial') {
    return status === 'trial' && deadlineIsInFuture(state.trial_ends_at, now);
  }
  if (type !== 'paid') return false;

  if (status === 'active') return true;
  if (status === 'overdue' || status === 'past_due') {
    return deadlineIsInFuture(state.billing_grace_until, now);
  }

  return false;
}

export function isBillingAccessBlocked(
  state: BillingAccessState | null | undefined,
  now = Date.now(),
) {
  if (isLocalBillingAccessBypassEnabled()) return false;
  return !hasBillingAccess(state, now);
}

export function isLocalBillingAccessBypassEnabled(
  nodeEnv = process.env.NODE_ENV,
  bypassFlag = process.env.NEXT_PUBLIC_BILLING_ACCESS_BYPASS,
) {
  return nodeEnv === 'development' && normalizeBillingValue(bypassFlag) === 'true';
}

export function isBillingAccessRoute(pathname: string, search = '') {
  if (pathname.startsWith('/checkout/')) return true;
  if (pathname === '/assinatura') return true;
  if (pathname !== '/settings') return false;

  const params = new URLSearchParams(search);
  return params.get('tab') === 'subscription';
}

export function isBillingPlanPromotionConfirmed(
  state: BillingPlanPromotionState | null | undefined,
  expectedPlanId: unknown,
) {
  const expected = typeof expectedPlanId === 'string' ? expectedPlanId.trim() : '';
  const activePlan = typeof state?.plan_id === 'string' ? state.plan_id.trim() : '';
  const pendingPlan = typeof state?.pending_plan_id === 'string'
    ? state.pending_plan_id.trim()
    : '';

  return (
    normalizeBillingValue(state?.subscription_status) === 'active'
    && expected !== ''
    && activePlan === expected
    && pendingPlan === ''
  );
}
