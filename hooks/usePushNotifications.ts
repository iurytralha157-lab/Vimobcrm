import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { settingsAPI } from '@/lib/api/settings';

const VAPID_PUBLIC_KEY = 'BC7q4HGKxwbHnzRl0uBTyTOm59GcEyxqM8fgSTGiSfNoxwYIIy8-HnbbpzQghQUzpzPmmifvn9t01EoTJaFa3uQ';

export const usePushNotifications = () => {
  const { user, profile } = useAuth();
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      let cancelled = false;

      queueMicrotask(() => {
        if (cancelled) return;
      setIsSupported(true);
      setPermission(Notification.permission);
      });

      navigator.serviceWorker.ready.then(registration => {
        registration.pushManager.getSubscription().then(sub => {
          if (cancelled) return;
          setSubscription(sub);
        });
      });

      return () => {
        cancelled = true;
      };
    }
  }, []);

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const subscribeUser = async () => {
    try {
      if (!isSupported) return;

      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== 'granted') {
        throw new Error('Permission not granted for notifications');
      }

      const registration = await navigator.serviceWorker.ready;

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      setSubscription(sub);

      if (user && profile?.organization_id) {
        const payload = sub.toJSON() as {
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        };
        if (payload.endpoint) {
          await settingsAPI.savePushToken({
            endpoint: payload.endpoint,
            p256dh: payload.keys?.p256dh ?? null,
            auth: payload.keys?.auth ?? null,
            userAgent: navigator.userAgent,
          }, profile.organization_id);
        }
      }

      return sub;
    } catch (err) {
      console.error('Failed to subscribe the user: ', err);
    }
  };

  const unsubscribeUser = async () => {
    try {
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        setSubscription(null);

        if (user) {
          await settingsAPI.deactivatePushToken(endpoint);
        }
      }
    } catch (err) {
      console.error('Error unsubscribing', err);
    }
  };

  return {
    isSupported,
    permission,
    subscription,
    subscribeUser,
    unsubscribeUser
  };
};
