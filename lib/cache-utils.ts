/**
 * Utility to perform deep cache clearing and force system updates
 */

export function getSupabaseAuthStorageKey(supabaseURL: string | undefined): string | null {
  const normalizedURL = supabaseURL?.trim();
  if (!normalizedURL) return null;

  try {
    const projectRef = new URL(normalizedURL).hostname.split('.')[0]?.trim();
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

export async function performFullCacheClear(options: {
  clearAuth?: boolean;
  reload?: boolean;
  redirectTo?: string;
} = {}): Promise<void> {
  const clearAuth = options.clearAuth ?? false;
  let reload = options.reload ?? false;
  let redirectTo = options.redirectTo;

  console.log('[CacheUtils] Starting full cache clear...', { clearAuth, reload, redirectTo });

  // Prevent cache clear + redirect/reload on public routes
  const publicRoutes = ['/login', '/cadastro', '/reset-password', '/onboarding', '/checkout', '/help', '/termos-de-uso', '/politica-de-privacidade'];
  const isPublicRoute = typeof window !== 'undefined' && publicRoutes.some(route => window.location.pathname.startsWith(route));

  if (isPublicRoute && (redirectTo || reload)) {
    console.log('[CacheUtils] Skipping redirect/reload on public route:', window.location.pathname);
    redirectTo = undefined;
    reload = false;
  }

  // 1. Preserve the app worker during routine cache refreshes. Re-registering
  // it would orphan the current push endpoint and create duplicate devices.
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (clearAuth) {
          const subscription = await registration.pushManager?.getSubscription();
          await subscription?.unsubscribe();
          await registration.unregister();
        } else {
          await registration.update();
        }
      }
    } catch (err) {
      console.error('[CacheUtils] Error refreshing service workers:', err);
    }
  }

  // 2. Clear all Cache Storage (PWA caches)
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    } catch (err) {
      console.error('[CacheUtils] Error clearing caches:', err);
    }
  }

  // 3. Clear localStorage
  const supabaseStorageKey = getSupabaseAuthStorageKey(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const activeSessionKeysToKeep = [
    'vimob-web-push-opt-out',
    'vimob-web-push-vapid-key',
    'vimob-current-push-endpoint',
    'web-push-prompt-dismissed',
    'pwa-install-prompt-dismissed',
  ];
  const authKeysToKeep = clearAuth
    ? ['remember_me', 'remembered_email', 'theme']
    : [
        ...(supabaseStorageKey ? [supabaseStorageKey] : []),
        'impersonating',
        'remember_me',
        'remembered_email',
        'theme',
        ...activeSessionKeysToKeep,
      ];
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && !authKeysToKeep.some(authKey => key.includes(authKey))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));

  // 4. Clear sessionStorage
  const sessionKeysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && !authKeysToKeep.some(authKey => key.includes(authKey))) {
      sessionKeysToRemove.push(key);
    }
  }
  sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));

  console.log('[CacheUtils] Full cache clear completed');

  if (redirectTo) {
    const url = new URL(redirectTo, window.location.origin);
    url.searchParams.set('v_refresh', Date.now().toString());
    window.location.replace(url.toString());
  } else if (reload) {
    const url = new URL(window.location.href);
    url.searchParams.set('v_refresh', Date.now().toString());
    window.location.replace(url.toString());
  }
}
