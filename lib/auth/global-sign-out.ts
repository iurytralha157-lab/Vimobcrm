type SignOutError = { status?: number } | Error | null;

type SignOutSession = { access_token: string; user?: { id: string } };
type SessionResult = {
  data: { session: SignOutSession | null };
  error: SignOutError;
};

type SignOutResult = { error: SignOutError };

export type GlobalSignOutOutcome = 'verified-global' | 'local-unverified' | 'cancelled';

export type GlobalSignOutGuard = {
  expectedUserId?: string | null;
  expectedSessionId?: string | null;
  expectedAccessToken?: string;
  isCurrent?: () => boolean;
  isOriginalSessionCleared?: () => boolean;
};
export type GlobalSignOutLifecycle = { generation: number; sessionKey: string | null; userId: string | null; mounted: boolean; pendingPush?: Set<AbortController> };

// Decoding only pins a client gesture. Server authorization still validates JWTs.
function sessionClaims(session: SignOutSession | null): { sub?: unknown; session_id?: unknown } {
  try {
    const payload = session?.access_token.split('.')[1];
    if (!payload) return {};
    const decoded: unknown = JSON.parse(globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded && typeof decoded === 'object' ? decoded : {};
  } catch { return {}; }
}
export function getGlobalSignOutSessionId(session: SignOutSession | null): string | null {
  const id = sessionClaims(session).session_id;
  return typeof id === 'string' && id.length > 0 && id.length <= 512 ? id : null;
}
export function getGlobalSignOutSessionKey(session: SignOutSession | null): string | null {
  if (!session) return null;
  const claims = sessionClaims(session);
  return JSON.stringify([session.user?.id ?? claims.sub ?? null, getGlobalSignOutSessionId(session) ?? session.access_token]);
}
export function trackGlobalSignOutSession(lifecycle: GlobalSignOutLifecycle, session: SignOutSession | null) {
  const key = getGlobalSignOutSessionKey(session);
  if (key !== lifecycle.sessionKey) {
    lifecycle.generation += 1;
    lifecycle.pendingPush?.forEach(controller => controller.abort());
    lifecycle.pendingPush?.clear();
  }
  lifecycle.sessionKey = key;
  lifecycle.userId = session?.user?.id ?? null;
}
export function captureGlobalSignOutGuard(session: SignOutSession | null, userId: string | null, lifecycle: GlobalSignOutLifecycle) {
  const generation = lifecycle.generation;
  const startingKey = lifecycle.sessionKey;
  const expectedKey = getGlobalSignOutSessionKey(session);
  const validSnapshot = (startingKey === expectedKey || startingKey === null)
    && (lifecycle.userId === userId || lifecycle.userId === null);
  const isCurrent = () => lifecycle.mounted && validSnapshot && (
    (lifecycle.generation === generation && lifecycle.sessionKey === startingKey)
    // A single original→null transition is the legitimate local SDK sign-out.
    || (startingKey !== null && lifecycle.generation === generation + 1 && lifecycle.sessionKey === null)
  );
  const isOriginalSessionCleared = () => lifecycle.mounted && validSnapshot
    && startingKey !== null && lifecycle.generation === generation + 1 && lifecycle.sessionKey === null;
  return { expectedUserId: userId, expectedSessionId: getGlobalSignOutSessionId(session),
    expectedAccessToken: session?.access_token, isCurrent, isOriginalSessionCleared, generation, key: expectedKey };
}

export type GlobalSignOutOperations = {
  getSession: () => PromiseLike<SessionResult>;
  revokeGlobal: (accessToken: string) => PromiseLike<SignOutResult>;
  clearLocal: () => PromiseLike<SignOutResult>;
};

function isAlreadyInvalidSession(error: SignOutError): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  return error.status === 401 || error.status === 403 || error.status === 404;
}

function isMissingSession(error: SignOutError): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error
    && error.name === 'AuthSessionMissingError');
}

function isAlreadyInvalidRefreshToken(error: SignOutError): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'refresh_token_not_found'
    || error.code === 'refresh_token_already_used';
}

function matchesOriginalSession(session: SignOutSession | null, guard: GlobalSignOutGuard): boolean {
  if (!session) {
    const hadSession = guard.expectedUserId != null || guard.expectedSessionId != null
      || guard.expectedAccessToken !== undefined;
    return !hadSession || guard.isOriginalSessionCleared?.() === true;
  }
  const claims = sessionClaims(session);
  const userId = session.user?.id ?? claims.sub ?? null;
  if (guard.expectedUserId !== undefined && (userId !== guard.expectedUserId
    || (typeof claims.sub === 'string' && claims.sub !== guard.expectedUserId))) return false;
  if (guard.expectedSessionId !== undefined && getGlobalSignOutSessionId(session) !== guard.expectedSessionId) return false;
  if (guard.expectedSessionId === null && guard.expectedAccessToken !== undefined
    && session.access_token !== guard.expectedAccessToken) return false;
  return true;
}

function isInvalidOrMissingSession(error: SignOutError): boolean {
  return isAlreadyInvalidSession(error) || isMissingSession(error) || isAlreadyInvalidRefreshToken(error);
}

async function clearLocalSession(operations: Pick<GlobalSignOutOperations, 'getSession' | 'clearLocal'>, guard: GlobalSignOutGuard, isCurrent: () => boolean) {
  if (!isCurrent()) return false;
  if (guard.isCurrent || guard.expectedUserId !== undefined || guard.expectedSessionId !== undefined
    || guard.expectedAccessToken !== undefined) {
    // An auth event may lag behind storage. Re-read the public SDK snapshot before
    // starting local sign-out; an already-started SDK lock cannot be pinned by JWT.
    const { data, error } = await operations.getSession();
    if (!isCurrent() || !matchesOriginalSession(data.session, guard)) return false;
    if (error && !isInvalidOrMissingSession(error)) throw error;
  }
  const { error } = await operations.clearLocal();
  if (!isCurrent()) return false;
  if (error) throw error;
  return true;
}

export async function signOutLocallyWithSessionGuard(
  operations: Pick<GlobalSignOutOperations, 'getSession' | 'clearLocal'>,
  guard: GlobalSignOutGuard,
): Promise<'local-unverified' | 'cancelled'> {
  const isCurrent = guard.isCurrent ?? (() => true);
  try {
    return await clearLocalSession(operations, guard, isCurrent) ? 'local-unverified' : 'cancelled';
  } catch (error) {
    if (!isCurrent()) return 'cancelled';
    throw error;
  }
}

/**
 * The normal auth.signOut(global) masks 401/403/404 from GoTrue. Call the
 * underlying documented JWT logout operation so only a 2xx response can be
 * reported as a verified global revocation.
 */
export async function signOutWithGlobalRevocation(
  operations: GlobalSignOutOperations,
  guard: GlobalSignOutGuard = {},
): Promise<GlobalSignOutOutcome> {
  const isCurrent = guard.isCurrent ?? (() => true);
  if (!isCurrent()) return 'cancelled';
  try {
    const { data, error: sessionError } = await operations.getSession();
    if (!isCurrent()) return 'cancelled';
    if (!matchesOriginalSession(data.session, guard)) return 'cancelled';
    if (sessionError) {
      if (!isInvalidOrMissingSession(sessionError)) {
        throw sessionError;
      }
      if (!await clearLocalSession(operations, guard, isCurrent)) return 'cancelled';
      return 'local-unverified';
    }

    const accessToken = data.session?.access_token;
    let outcome: GlobalSignOutOutcome = 'local-unverified';

    if (accessToken) {
      const { error } = await operations.revokeGlobal(accessToken);
      if (!isCurrent()) return 'cancelled';
      if (error && !isAlreadyInvalidSession(error)) throw error;
      if (!error) outcome = 'verified-global';
    }

    // The caller only navigates away after the SDK confirms local cleanup.
    if (!await clearLocalSession(operations, guard, isCurrent)) return 'cancelled';

    return outcome;
  } catch (error) {
    if (!isCurrent()) return 'cancelled';
    throw error;
  }
}
