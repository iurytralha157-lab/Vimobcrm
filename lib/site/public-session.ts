export const PUBLIC_SITE_SESSION_KEY_PREFIX = "vimob_public_session_v2";
export const PUBLIC_SITE_SESSION_STARTED_KEY_PREFIX =
  "vimob_public_session_started_v2";
export const PUBLIC_SITE_SESSION_ACTIVITY_KEY_PREFIX =
  "vimob_public_session_activity_v2";
export const PUBLIC_SITE_SESSION_INACTIVITY_MS = 30 * 60 * 1_000;
export const PUBLIC_CONTACT_SYNTHETIC_SESSION_PREFIX = "site-contact:";

export type PublicSiteSessionStorage = Pick<Storage, "getItem" | "setItem">;

export function resolvePublicSiteSessionId(
  storage: PublicSiteSessionStorage,
  organizationId: string,
  createSessionId: () => string,
  options: Readonly<{
    now?: number;
    recordActivity?: boolean;
  }> = {},
) {
  const storageKey = getPublicSiteSessionKey(organizationId);
  const current = storage.getItem(storageKey)?.trim();
  const now = options.now ?? Date.now();
  const recordActivity = options.recordActivity ?? true;
  const activityKey = getPublicSiteSessionActivityKey(organizationId);
  const lastActivity = Number(storage.getItem(activityKey));

  if (current) {
    if (!recordActivity) return current;

    const hasValidActivity = Number.isFinite(lastActivity) && lastActivity > 0;
    const isInactive =
      hasValidActivity &&
      now - lastActivity > PUBLIC_SITE_SESSION_INACTIVITY_MS;
    if (!isInactive) {
      storage.setItem(activityKey, String(now));
      return current;
    }
  }

  const sessionId = createSessionId().trim();
  if (!sessionId) {
    throw new Error("Public site session id must not be empty");
  }

  storage.setItem(storageKey, sessionId);
  storage.setItem(activityKey, String(now));
  return sessionId;
}

export function getPublicSiteSessionKey(organizationId: string) {
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }
  return `${PUBLIC_SITE_SESSION_KEY_PREFIX}:${normalizedOrganizationId}`;
}

export function markPublicSiteSessionStarted(
  storage: PublicSiteSessionStorage,
  organizationId: string,
  sessionId: string,
) {
  const storageKey = getPublicSiteSessionStartedKey(organizationId);
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error("Public site session id must not be empty");
  }
  if (
    hasPublicSiteSessionStarted(storage, organizationId, normalizedSessionId)
  ) {
    return false;
  }
  storage.setItem(storageKey, normalizedSessionId);
  return true;
}

export function hasPublicSiteSessionStarted(
  storage: PublicSiteSessionStorage,
  organizationId: string,
  sessionId: string,
) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error("Public site session id must not be empty");
  }
  return (
    storage.getItem(getPublicSiteSessionStartedKey(organizationId)) ===
    normalizedSessionId
  );
}

export function createPublicSiteSessionStartCoordinator() {
  const inFlight = new Map<string, Promise<boolean>>();

  return function ensurePublicSiteSessionStarted(
    key: string,
    options: Readonly<{
      hasStarted: () => boolean;
      start: () => Promise<unknown>;
      markStarted: () => void;
    }>,
  ) {
    if (options.hasStarted()) return Promise.resolve(true);

    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = Promise.resolve()
      .then(options.start)
      .then(() => {
        options.markStarted();
        return true;
      })
      .catch(() => false)
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, pending);
    return pending;
  };
}

export function getPublicSiteSessionActivityKey(organizationId: string) {
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }
  return `${PUBLIC_SITE_SESSION_ACTIVITY_KEY_PREFIX}:${normalizedOrganizationId}`;
}

export function getPublicSiteSessionStartedKey(organizationId: string) {
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }
  return `${PUBLIC_SITE_SESSION_STARTED_KEY_PREFIX}:${normalizedOrganizationId}`;
}
