import { settingsAPI } from '@/lib/api/settings';

const CURRENT_PUSH_ENDPOINT_KEY = 'vimob-current-push-endpoint';

export function rememberCurrentPushEndpoint(endpoint: string) {
  if (typeof window === 'undefined' || !endpoint) return;
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
) {
  if (typeof window === 'undefined') return;

  const endpoints = new Set<string>();
  const storedEndpoint = storedCurrentPushEndpoint();
  if (storedEndpoint) endpoints.add(storedEndpoint);

  let browserSubscription: PushSubscription | null = null;
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      browserSubscription = await registration?.pushManager.getSubscription() || null;
      if (browserSubscription?.endpoint) endpoints.add(browserSubscription.endpoint);
    } catch {
      // Continue with the endpoint remembered by the active client session.
    }
  }

  let deactivationError: unknown = null;
  for (const endpoint of endpoints) {
    try {
      await settingsAPI.deactivatePushToken(endpoint, organizationId);
    } catch (error) {
      deactivationError ||= error;
    }
  }

  if (browserSubscription) {
    try {
      await browserSubscription.unsubscribe();
    } catch (error) {
      deactivationError ||= error;
    }
  }

  forgetCurrentPushEndpoint();
  if (deactivationError) throw deactivationError;
}
