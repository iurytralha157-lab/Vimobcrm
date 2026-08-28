import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { settingsAPI } from '@/lib/api/settings';
import { getPushNotificationRoute } from '@/lib/notification-routing';
import {
  getTenantEnabledModules,
  getTenantPermissions,
  isTenantContextForOrganization,
} from '@/lib/access/tenant-navigation';
import {
  forgetCurrentPushEndpoint,
  rememberCurrentPushEndpoint,
} from '@/lib/pwa/push-session';
import { useQueryClient } from '@tanstack/react-query';

// Type definitions for Capacitor Push Notifications
interface PushNotificationToken {
  value: string;
}

interface PushNotificationActionPerformed {
  actionId: string;
  notification: {
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
}

interface PushNotificationReceived {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

type CapacitorPluginListenerHandle = { remove: () => void | Promise<void> };

interface CapacitorPushNotifications {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  register(): Promise<void>;
  addListener(event: 'registration', callback: (token: PushNotificationToken) => void): Promise<CapacitorPluginListenerHandle>;
  addListener(event: 'registrationError', callback: (error: unknown) => void): Promise<CapacitorPluginListenerHandle>;
  addListener(event: 'pushNotificationReceived', callback: (notification: PushNotificationReceived) => void): Promise<CapacitorPluginListenerHandle>;
  addListener(event: 'pushNotificationActionPerformed', callback: (action: PushNotificationActionPerformed) => void): Promise<CapacitorPluginListenerHandle>;
}

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

type WindowWithCapacitor = Window & typeof globalThis & {
  Capacitor?: CapacitorBridge;
};

const getCapacitorBridge = () =>
  typeof window !== 'undefined' ? (window as WindowWithCapacitor).Capacitor : undefined;

// Check if running in Capacitor native environment
function isCapacitorNative(): boolean {
  return getCapacitorBridge()?.isNativePlatform?.() === true;
}

// Get platform name
function getPlatform(): 'android' | 'ios' | 'web' {
  if (!isCapacitorNative()) return 'web';
  const platform = getCapacitorBridge()?.getPlatform?.();
  return platform === 'ios' ? 'ios' : 'android';
}

// Dynamically import Capacitor Push Notifications
async function getPushNotificationsPlugin(): Promise<CapacitorPushNotifications | null> {
  if (!isCapacitorNative()) {
    console.log('[Push] Not running in Capacitor native environment');
    return null;
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    return PushNotifications as CapacitorPushNotifications;
  } catch (error) {
    console.error('[Push] Failed to import Capacitor Push Notifications:', error);
    return null;
  }
}

export function usePushNotifications() {
  const { profile, organization, tenantContext } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const initialized = useRef(false);
  const initializationGeneration = useRef(0);
  const currentToken = useRef<string | null>(null);
  const tokenOwnerProfileId = useRef<string | null>(null);
  const listenerHandles = useRef<CapacitorPluginListenerHandle[]>([]);
  const profileId = profile?.id;
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const hasCurrentTenantContext = isTenantContextForOrganization(
    activeOrganizationId,
    tenantContext,
  );
  const tenantPermissions = hasCurrentTenantContext && tenantContext
    ? getTenantPermissions(tenantContext)
    : [];
  const canViewWhatsApp = Boolean(
    hasCurrentTenantContext
      && tenantContext
      && getTenantEnabledModules(tenantContext).includes('whatsapp')
      && (tenantPermissions.includes('*') || tenantPermissions.includes('whatsapp_view')),
  );
  const pushContextRef = useRef({
    profileId,
    organizationId: activeOrganizationId,
    canViewWhatsApp,
  });

  useEffect(() => {
    pushContextRef.current = {
      profileId,
      organizationId: activeOrganizationId,
      canViewWhatsApp,
    };
  }, [activeOrganizationId, canViewWhatsApp, profileId]);

  // Save token to database
  const saveToken = useCallback(async (token: string) => {
    currentToken.current = token;
    const currentContext = pushContextRef.current;
    const currentProfileId = currentContext.profileId;
    const currentOrganizationId = currentContext.organizationId;
    tokenOwnerProfileId.current = currentProfileId || null;

    if (!currentProfileId || !currentOrganizationId) {
      console.log('[Push] No user profile, skipping token save');
      return;
    }

    const platform = getPlatform();

    try {
      await settingsAPI.savePushToken({
        endpoint: `native:${platform}:${token}`,
        userAgent: `${navigator.userAgent} | platform=${platform}`,
      }, currentOrganizationId);
      rememberCurrentPushEndpoint(`native:${platform}:${token}`);
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'push-devices', currentOrganizationId],
      });
      console.log('[Push] Token saved successfully');
    } catch (error) {
      console.error('[Push] Error saving token:', error);
    }
  }, [queryClient]);

  // Handle notification click (navigation)
  const handleNotificationAction = useCallback((data: Record<string, unknown>) => {
    console.log('[Push] Notification clicked, data:', data);
    router.push(getPushNotificationRoute(data, {
      canViewWhatsApp: pushContextRef.current.canViewWhatsApp,
    }));
  }, [router]);

  const removeOwnListeners = useCallback(async () => {
    const handles = listenerHandles.current.splice(0);
    await Promise.allSettled(handles.map((handle) => Promise.resolve(handle.remove())));
  }, []);

  // Deactivate token on logout
  const deactivateToken = useCallback(async () => {
    const currentContext = pushContextRef.current;
    if (!currentToken.current || !currentContext.profileId) return;

    try {
      await settingsAPI.deactivatePushToken(
        `native:${getPlatform()}:${currentToken.current}`,
        currentContext.organizationId,
      );

      console.log('[Push] Token deactivated');
      forgetCurrentPushEndpoint(`native:${getPlatform()}:${currentToken.current}`);
      currentToken.current = null;
      tokenOwnerProfileId.current = null;
      if (currentContext.organizationId) {
        void queryClient.invalidateQueries({
          queryKey: ['settings', 'push-devices', currentContext.organizationId],
        });
      }
    } catch (error) {
      console.error('[Push] Error deactivating token:', error);
    }
  }, [queryClient]);

  // Keep the native token bound to the currently selected organization.
  useEffect(() => {
    if (
      !isCapacitorNative()
      || !currentToken.current
      || !profileId
      || tokenOwnerProfileId.current !== profileId
    ) return;
    void saveToken(currentToken.current);
  }, [activeOrganizationId, profileId, saveToken]);

  // Initialize on mount
  useEffect(() => {
    if (!isCapacitorNative()) {
      console.log('[Push] Web environment, skipping push initialization');
      return;
    }

    if (!profileId || initialized.current) return;

    const generation = ++initializationGeneration.current;
    const isCurrentInitialization = () => initializationGeneration.current === generation;
    initialized.current = true;

    const addOwnedListener = async (
      createListener: () => Promise<CapacitorPluginListenerHandle>,
    ) => {
      const handle = await createListener();
      if (!isCurrentInitialization()) {
        await Promise.resolve(handle.remove());
        return;
      }
      listenerHandles.current.push(handle);
    };

    const initializePush = async () => {
      const PushNotifications = await getPushNotificationsPlugin();
      if (!isCurrentInitialization()) return;
      if (!PushNotifications) {
        console.log('[Push] Push notifications not available');
        initialized.current = false;
        return;
      }

      console.log('[Push] Initializing push notifications...');

      try {
        const permResult = await PushNotifications.requestPermissions();
        if (!isCurrentInitialization()) return;
        console.log('[Push] Permission result:', permResult.receive);

        if (permResult.receive !== 'granted') {
          console.log('[Push] Permission not granted');
          initialized.current = false;
          return;
        }

        await addOwnedListener(() => PushNotifications.addListener('registration', (token) => {
          console.log('[Push] Registered with token:', token.value.substring(0, 20) + '...');
          void saveToken(token.value);
        }));
        await addOwnedListener(() => PushNotifications.addListener('registrationError', (error) => {
          console.error('[Push] Registration error:', error);
        }));
        await addOwnedListener(() => PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('[Push] Notification received in foreground:', notification.title);
        }));
        await addOwnedListener(() => PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('[Push] Notification action:', action.actionId);
          handleNotificationAction(action.notification.data || {});
        }));

        if (!isCurrentInitialization()) return;
        await PushNotifications.register();
        if (isCurrentInitialization()) {
          console.log('[Push] Push notifications initialized successfully');
        }
      } catch (error) {
        if (!isCurrentInitialization()) return;
        console.error('[Push] Initialization error:', error);
        initialized.current = false;
        await removeOwnListeners();
      }
    };

    void initializePush();

    return () => {
      if (initializationGeneration.current === generation) {
        initializationGeneration.current += 1;
      }
      initialized.current = false;
      currentToken.current = null;
      tokenOwnerProfileId.current = null;
      void removeOwnListeners();
    };
  }, [profileId, saveToken, handleNotificationAction, removeOwnListeners]);

  return {
    isNative: isCapacitorNative(),
    platform: getPlatform(),
    deactivateToken,
  };
}
