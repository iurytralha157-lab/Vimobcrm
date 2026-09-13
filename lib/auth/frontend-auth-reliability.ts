export const PAID_SIGNUP_SESSION_WAIT_MS = 2_500;
export const ORGANIZATION_SWITCH_WAIT_MS = 12_000;
export const LOGIN_OPERATION_WAIT_MS = 15_000;
export const PASSWORD_RECOVERY_REQUEST_WAIT_MS = 15_000;
export const EMAIL_CONFIRMATION_RESEND_WAIT_MS = 15_000;
export const POST_LOGIN_ROUTING_WAIT_MS = 15_000;

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
