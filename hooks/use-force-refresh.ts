import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { performFullCacheClear } from '@/lib/cache-utils';

const CHANNEL_NAME = 'system-updates-v4'; // Bumped version to v4
const STORAGE_KEY = `${CHANNEL_NAME}:force-refresh`;

/**
 * Hook that listens for force refresh broadcasts and reloads the page
 * when received. Used by all users.
 */
export function useForceRefreshListener(enabled: boolean = true, userId?: string) {
  useEffect(() => {
    // Só habilita se estiver explicitamente enabled, tiver um userId E não estiver em rota pública
    const isPublicRoute = [
      '/login',
      '/cadastro',
      '/forgot-password',
      '/reset-password',
      '/onboarding',
      '/checkout',
      '/termos-de-uso',
      '/politica-de-privacidade'
    ].includes(window.location.pathname);

    if (!enabled || !userId || isPublicRoute) {
      if (userId) {
        console.log('[ForceRefresh] Skipping subscription for public route or disabled state');
      }
      return;
    }

    console.log('[ForceRefresh] Initializing for user:', userId);
    const channel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(CHANNEL_NAME)
      : null;

    const handleRefresh = async (payload: unknown) => {
      console.log('[ForceRefresh] Received refresh signal:', payload);
      toast.info('Atualizando sistema... Por favor aguarde.', {
        duration: 3000,
      });

      await performFullCacheClear({
        clearAuth: false,
        reload: true,
      });
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.event === 'force-refresh') {
        void handleRefresh(event.data);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        void handleRefresh(event.newValue);
      }
    };

    channel?.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);

    return () => {
      console.log('[ForceRefresh] Removing local channel');
      channel?.removeEventListener('message', handleMessage);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, [enabled, userId]);
}


/**
 * Hook that provides a function to broadcast force refresh to all users.
 * Used by admins only.
 */
export function useForceRefreshBroadcast() {
  const broadcastRefresh = useCallback(async () => {
    const payload = {
      event: 'force-refresh',
      timestamp: new Date().toISOString(),
      message: 'Admin triggered force refresh',
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    console.log('[ForceRefresh] Broadcast sent');

    return true;
  }, []);

  return { broadcastRefresh };
}
