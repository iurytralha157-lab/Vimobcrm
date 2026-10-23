import { settingsAPI } from '@/lib/api/settings';
import type { PushDeviceRequestOptions } from '@/lib/api/settings';
import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId } from '@/lib/api/vimob-client';

const CURRENT_PUSH_ENDPOINT_KEY = 'vimob-current-push-endpoint';
let bindingRevision = 0;

export function rememberCurrentPushEndpoint(endpoint: string) {
  if (typeof window === 'undefined' || !endpoint) return;
  bindingRevision += 1;
  try {
    sessionStorage.setItem(CURRENT_PUSH_ENDPOINT_KEY, endpoint);
  } catch {
    // Restricted storage does not prevent registration itself.
  }
}

export function forgetCurrentPushEndpoint(endpoint?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!endpoint || sessionStorage.getItem(CURRENT_PUSH_ENDPOINT_KEY) === endpoint) {
      sessionStorage.removeItem(CURRENT_PUSH_ENDPOINT_KEY);
    }
  } catch {
    // Restricted storage is optional.
  }
}

function storedCurrentPushEndpoint() {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(CURRENT_PUSH_ENDPOINT_KEY);
  } catch {
    return null;
  }
}

/** Best-effort device-scoped cleanup that must run while auth is still valid. */
export async function deactivateCurrentPushEndpoint(
  organizationId?: string | null,
  options: PushDeviceRequestOptions & { isCurrent?: () => boolean } = {},
) {
  if (typeof window === 'undefined') return;
  const expectedUserId = options.expectedUserId === undefined ? getVimobAPIAccessTokenUserId() : options.expectedUserId;
  const expectedSessionId = options.expectedSessionId === undefined ? getVimobAPIAccessTokenSessionId() : options.expectedSessionId;
  const revision = bindingRevision;
  const isCurrent = () => Boolean(expectedUserId) && !options.signal?.aborted
    && Boolean(expectedSessionId) && getVimobAPIAccessTokenSessionId() === expectedSessionId
    && getVimobAPIAccessTokenUserId() === expectedUserId && bindingRevision === revision
    && (options.isCurrent?.() ?? true);
  if (!isCurrent()) return;

  const endpoints = new Set<string>();
  const storedEndpoint = storedCurrentPushEndpoint();
  if (storedEndpoint) endpoints.add(storedEndpoint);

  let browserSubscription: PushSubscription | null = null;
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!isCurrent()) return;
      browserSubscription = await registration?.pushManager.getSubscription() || null;
      if (!isCurrent()) return;
      if (browserSubscription?.endpoint) endpoints.add(browserSubscription.endpoint);
    } catch {
      // Continue with the endpoint remembered by the active client session.
    }
  }

  let deactivationError: unknown = null;
  for (const endpoint of endpoints) {
    if (!isCurrent()) return;
    try {
      await settingsAPI.deactivatePushToken(endpoint, organizationId, { expectedUserId, expectedSessionId, signal: options.signal });
    } catch (error) {
      deactivationError ||= error;
    }
  }

  if (browserSubscription) {
    if (!isCurrent()) return;
    try {
      await browserSubscription.unsubscribe();
    } catch (error) {
      deactivationError ||= error;
    }
  }

  if (!isCurrent()) return;
  forgetCurrentPushEndpoint(storedEndpoint);
  if (deactivationError) throw deactivationError;
}
