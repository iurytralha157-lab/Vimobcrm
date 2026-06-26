import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { settingsAPI } from '@/lib/api/settings';

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

interface CapacitorPushNotifications {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  register(): Promise<void>;
  addListener(event: 'registration', callback: (token: PushNotificationToken) => void): Promise<{ remove: () => void }>;
  addListener(event: 'registrationError', callback: (error: unknown) => void): Promise<{ remove: () => void }>;
  addListener(event: 'pushNotificationReceived', callback: (notification: PushNotificationReceived) => void): Promise<{ remove: () => void }>;
  addListener(event: 'pushNotificationActionPerformed', callback: (action: PushNotificationActionPerformed) => void): Promise<{ remove: () => void }>;
  removeAllListeners(): Promise<void>;
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
  const { profile } = useAuth();
  const router = useRouter();
  const initialized = useRef(false);
  const currentToken = useRef<string | null>(null);
  const profileId = profile?.id;
  const profileOrganizationId = profile?.organization_id;

  // Save token to database
  const saveToken = useCallback(async (token: string) => {
    if (!profileId || !profileOrganizationId) {
      console.log('[Push] No user profile, skipping token save');
      return;
    }

    const platform = getPlatform();

    try {
      await settingsAPI.savePushToken({
        endpoint: `native:${platform}:${token}`,
        userAgent: `${navigator.userAgent} | platform=${platform}`,
      }, profileOrganizationId);
      console.log('[Push] Token saved successfully');
      currentToken.current = token;
    } catch (error) {
      console.error('[Push] Error saving token:', error);
    }
  }, [profileId, profileOrganizationId]);

  // Handle notification click (navigation)
  const handleNotificationAction = useCallback((data: Record<string, unknown>) => {
    console.log('[Push] Notification clicked, data:', data);

    const leadId = data?.lead_id;
    const type = data?.type;

    if (leadId) {
      // Navigate to lead detail or relevant page
      router.push(`/crm/pipelines?openLeadId=${encodeURIComponent(String(leadId))}`);
    } else if (type === 'commission' || type === 'financial') {
      router.push('/financeiro');
    } else if (type === 'task') {
      router.push('/agenda');
    } else {
      // Default: go to notifications page
      router.push('/notifications');
    }
  }, [router]);

  // Initialize push notifications
  const initializePush = useCallback(async () => {
    if (initialized.current) return;
    if (!profileId) return;

    const PushNotifications = await getPushNotificationsPlugin();
    if (!PushNotifications) {
      console.log('[Push] Push notifications not available');
      return;
    }

    console.log('[Push] Initializing push notifications...');
    initialized.current = true;

    try {
      // Request permission
      const permResult = await PushNotifications.requestPermissions();
      console.log('[Push] Permission result:', permResult.receive);

      if (permResult.receive !== 'granted') {
        console.log('[Push] Permission not granted');
        return;
      }

      // Register with FCM/APNs
      await PushNotifications.register();

      // Listen for registration success
      await PushNotifications.addListener('registration', (token) => {
        console.log('[Push] Registered with token:', token.value.substring(0, 20) + '...');
        saveToken(token.value);
      });

      // Listen for registration errors
      await PushNotifications.addListener('registrationError', (error) => {
        console.error('[Push] Registration error:', error);
      });

      // Listen for push received (foreground)
      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[Push] Notification received in foreground:', notification.title);
        // Foreground notifications are handled by the in-app notification system
        // We don't need to do anything special here
      });

      // Listen for notification action (user tapped notification)
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('[Push] Notification action:', action.actionId);
        handleNotificationAction(action.notification.data || {});
      });

      console.log('[Push] Push notifications initialized successfully');
    } catch (error) {
      console.error('[Push] Initialization error:', error);
      initialized.current = false;
    }
  }, [profileId, saveToken, handleNotificationAction]);

  // Deactivate token on logout
  const deactivateToken = useCallback(async () => {
    if (!currentToken.current || !profileId) return;

    try {
      await settingsAPI.deactivatePushToken(`native:${getPlatform()}:${currentToken.current}`);

      console.log('[Push] Token deactivated');
      currentToken.current = null;
    } catch (error) {
      console.error('[Push] Error deactivating token:', error);
    }
  }, [profileId]);

  // Initialize on mount
  useEffect(() => {
    if (!isCapacitorNative()) {
      console.log('[Push] Web environment, skipping push initialization');
      return;
    }

    initializePush();

    return () => {
      // Cleanup listeners on unmount
      getPushNotificationsPlugin().then((PushNotifications) => {
        PushNotifications?.removeAllListeners();
      });
    };
  }, [initializePush]);

  return {
    isNative: isCapacitorNative(),
    platform: getPlatform(),
    deactivateToken,
  };
}
