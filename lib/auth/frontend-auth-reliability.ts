export const PAID_SIGNUP_SESSION_WAIT_MS = 2_500;
export const ORGANIZATION_SWITCH_WAIT_MS = 12_000;
export const LOGIN_OPERATION_WAIT_MS = 15_000;
export const PASSWORD_RECOVERY_REQUEST_WAIT_MS = 15_000;
export const EMAIL_CONFIRMATION_RESEND_WAIT_MS = 15_000;
export const POST_LOGIN_ROUTING_WAIT_MS = 15_000;

type NoMembershipAccountStatus = {
  profileExists: boolean;
  globallyActive: boolean;
  isSuperAdmin: boolean;
};

export function resolveNoMembershipAccountEntry(status: NoMembershipAccountStatus) {
  if (!status.profileExists) return 'missing_profile' as const;
  if (!status.globallyActive) return 'globally_suspended' as const;
  if (status.isSuperAdmin) return 'load_super_admin_profile' as const;
  return 'no_organization' as const;
}

export type MembershipRevalidationState = {
  active: boolean;
  hasUser: boolean;
  authInitialized: boolean;
  organizationsLoaded: boolean;
  isInitializingOrganization: boolean;
  isLoggingOut: boolean;
  inFlight: boolean;
  onRecoveryRoute: boolean;
  fromFocus: boolean;
  now: number;
  lastRefreshAt: number;
  focusIntervalMs: number;
};

export function shouldRevalidateMembership(state: MembershipRevalidationState): boolean {
  if (
    !state.active || !state.hasUser || !state.authInitialized
    || !state.organizationsLoaded || state.isInitializingOrganization
    || state.isLoggingOut || state.inFlight || state.onRecoveryRoute
  ) return false;

  return !state.fromFocus || state.now - state.lastRefreshAt >= state.focusIntervalMs;
}

export type BestEffortAuthOperationStatus =
  | 'completed'
  | 'failed'
  | 'timed_out';

export type AuthOperationResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'timed_out' };

export async function runAuthOperationWithTimeout<T>(
  operation: () => PromiseLike<T>,
  timeoutMs: number,
): Promise<AuthOperationResult<T>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('O limite da operacao de autenticacao precisa ser positivo.');
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const operationResult: Promise<AuthOperationResult<T>> = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ status: 'completed', value }) as const,
      (error: unknown) => ({ status: 'failed', error }) as const,
    );
  const timeoutResult = new Promise<AuthOperationResult<T>>((resolve) => {
    timeoutId = setTimeout(() => resolve({ status: 'timed_out' }), timeoutMs);
  });

  try {
    return await Promise.race([operationResult, timeoutResult]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export async function runBestEffortAuthOperation<T>(
  operation: () => PromiseLike<T>,
  timeoutMs: number,
): Promise<BestEffortAuthOperationStatus> {
  const result = await runAuthOperationWithTimeout(operation, timeoutMs);
  return result.status;
}

export async function initializeSignedInUserContext(
  loadProfile: () => PromiseLike<unknown>,
  loadOrganizations: () => PromiseLike<unknown>,
) {
  await loadProfile();
  await loadOrganizations();
}

type OrganizationSelectionAuthEventInput = {
  authEvent: string;
  credentialSignInInFlight: boolean;
};

export function shouldForceOrganizationSelectionForAuthEvent({
  authEvent,
  credentialSignInInFlight,
}: OrganizationSelectionAuthEventInput) {
  return authEvent === 'SIGNED_IN' && credentialSignInInFlight;
}

type PostLoginRoutingWaitInput = {
  authInitialized: boolean;
  authLoading: boolean;
  isInitializingOrganization: boolean;
  organizationsLoaded: boolean;
};

export function shouldWaitForPostLoginRouting({
  authInitialized,
  authLoading,
  isInitializingOrganization,
  organizationsLoaded,
}: PostLoginRoutingWaitInput) {
  return !authInitialized
    || authLoading
    || !organizationsLoaded
    || isInitializingOrganization;
}

type OrganizationSelectionLoaderInput = {
  authLoading: boolean;
  hasSelectionError: boolean;
  isInitializingOrganization: boolean;
  organizationsLoaded: boolean;
  shouldAutoRouteSingleOrganization: boolean;
};

export function shouldShowOrganizationSelectionLoader({
  authLoading,
  hasSelectionError,
  isInitializingOrganization,
  organizationsLoaded,
  shouldAutoRouteSingleOrganization,
}: OrganizationSelectionLoaderInput) {
  if (hasSelectionError) return false;

  return authLoading
    || !organizationsLoaded
    || isInitializingOrganization
    || shouldAutoRouteSingleOrganization;
}
