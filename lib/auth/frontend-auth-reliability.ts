export const PAID_SIGNUP_SESSION_WAIT_MS = 2_500;
export const ORGANIZATION_SWITCH_WAIT_MS = 12_000;

export type BestEffortAuthOperationStatus =
  | 'completed'
  | 'failed'
  | 'timed_out';

export async function runBestEffortAuthOperation<T>(
  operation: () => PromiseLike<T>,
  timeoutMs: number,
): Promise<BestEffortAuthOperationStatus> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('O limite da operacao de autenticacao precisa ser positivo.');
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const operationResult: Promise<BestEffortAuthOperationStatus> = Promise.resolve()
    .then(operation)
    .then(
      () => 'completed' as const,
      () => 'failed' as const,
    );

  const timeoutResult = new Promise<BestEffortAuthOperationStatus>((resolve) => {
    timeoutId = setTimeout(() => resolve('timed_out'), timeoutMs);
  });

  try {
    return await Promise.race([operationResult, timeoutResult]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export async function initializeSignedInUserContext(
  loadProfile: () => PromiseLike<unknown>,
  loadOrganizations: () => PromiseLike<unknown>,
) {
  await loadProfile();
  await loadOrganizations();
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
