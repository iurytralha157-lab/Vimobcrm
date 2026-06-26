/**
 * Utility to perform deep cache clearing and force system updates
 */

const SUPABASE_STORAGE_KEY = 'sb-iemalzlfnbouobyjwlwi-auth-token';

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
  const publicRoutes = ['/login', '/cadastro', '/reset-password', '/onboarding', '/checkout', '/termos-de-uso', '/politica-de-privacidade'];
  const isPublicRoute = typeof window !== 'undefined' && publicRoutes.some(route => window.location.pathname.startsWith(route));

  if (isPublicRoute && (redirectTo || reload)) {
    console.log('[CacheUtils] Skipping redirect/reload on public route:', window.location.pathname);
    redirectTo = undefined;
    reload = false;
  }

  // 1. Unregister all Service Workers
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    } catch (err) {
      console.error('[CacheUtils] Error unregistering service workers:', err);
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
  const authKeysToKeep = clearAuth
    ? ['remember_me', 'remembered_email']
    : [SUPABASE_STORAGE_KEY, 'impersonating', 'remember_me', 'remembered_email'];
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
