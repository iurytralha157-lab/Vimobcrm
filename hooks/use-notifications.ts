import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notificationsAPI } from '@/lib/api/notifications';
import { connectBackendRealtime } from '@/lib/api/realtime';

export type { Notification } from '@/lib/api/notifications';

let globalAudioContext: AudioContext | null = null;
let audioInitialized = false;
const NOTIFICATIONS_INITIAL_LOAD_DELAY_MS = 2500;
const NOTIFICATION_REALTIME_EVENTS = new Set([
  'notification.created',
  'lead.meta_webhook_received',
  'lead.webhook_received',
  'lead.created',
  'lead.updated',
  'lead.assigned',
  'lead.reassigned',
]);

type WebkitAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

async function initializeAudio(): Promise<void> {
  if (audioInitialized) return;

  try {
    const AudioContextConstructor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) return;
    globalAudioContext = new AudioContextConstructor();
    audioInitialized = true;
  } catch {
    audioInitialized = false;
  }
}

async function resumeAudioContext(): Promise<void> {
  if (globalAudioContext?.state === 'suspended') {
    try {
      await globalAudioContext.resume();
    } catch {
      // Audio is optional.
    }
  }
}

function playSound(type: 'notification' | 'new-lead', volume: number = 0.7): void {
  if (!globalAudioContext || !audioInitialized) return;

  try {
    if (globalAudioContext.state === 'suspended') {
      void globalAudioContext.resume();
    }

    const now = globalAudioContext.currentTime;
    const oscillator = globalAudioContext.createOscillator();
    const gainNode = globalAudioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = type === 'new-lead' ? 880 : 660;

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(volume * 0.08, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    oscillator.connect(gainNode);
    gainNode.connect(globalAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  } catch {
    // Sound should never break notification rendering.
  }
}

async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

function useDelayedQueryEnabled(enabledKey: string | null, delayMs = NOTIFICATIONS_INITIAL_LOAD_DELAY_MS) {
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!enabledKey) return undefined;

    const timeout = setTimeout(() => setReadyKey(enabledKey), delayMs);
    return () => clearTimeout(timeout);
  }, [delayMs, enabledKey]);

  return enabledKey !== null && readyKey === enabledKey;
}

export function useNotifications() {
  const { profile, organization } = useAuth();
  const queryClient = useQueryClient();
  const audioSetupDone = useRef(false);
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryEnabled = useDelayedQueryEnabled(
    profile?.id && organization?.id ? `${profile.id}:${organization.id}` : null,
  );

  useEffect(() => {
    if (audioSetupDone.current) return;

    const handleInteraction = async () => {
      if (audioSetupDone.current) return;
      audioSetupDone.current = true;

      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);

      await initializeAudio();
      await requestNotificationPermission();
    };

    document.addEventListener('click', handleInteraction);
    document.addEventListener('keydown', handleInteraction);
    document.addEventListener('touchstart', handleInteraction);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void resumeAudioContext();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const playNotificationSound = useCallback((type: 'notification' | 'new-lead' = 'notification') => {
    playSound(type, type === 'new-lead' ? 0.7 : 0.5);
  }, []);

  useEffect(() => {
    const organizationId = organization?.id || profile?.organization_id;
    const userId = profile?.id;
    if (!organizationId || !userId) return undefined;

    const refreshNotifications = () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
      }, 300);
    };

    const disconnect = connectBackendRealtime({
      organizationId,
      onEvent: (event) => {
        if (!NOTIFICATION_REALTIME_EVENTS.has(event.type)) return;
        if (event.userId && event.userId !== userId) return;
        refreshNotifications();
      },
    });

    return () => {
      if (realtimeRefreshTimer.current) {
        clearTimeout(realtimeRefreshTimer.current);
        realtimeRefreshTimer.current = null;
      }
      disconnect();
    };
  }, [organization?.id, profile?.id, profile?.organization_id, queryClient]);

  const query = useQuery({
    queryKey: ['notifications', profile?.id, organization?.id],
    queryFn: () => notificationsAPI.list({ userId: profile!.id, limit: 50 }),
    enabled: queryEnabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous ?? [],
  });

  return {
    ...query,
    playNotificationSound,
  };
}

export function useUnreadNotificationsCount() {
  const { profile, organization } = useAuth();
  const queryEnabled = useDelayedQueryEnabled(
    profile?.id && organization?.id ? `${profile.id}:${organization.id}` : null,
  );

  return useQuery({
    queryKey: ['unread-notifications-count', profile?.id, organization?.id],
    queryFn: async () => {
      const response = await notificationsAPI.unreadCount(profile!.id);
      return response.count || 0;
    },
    enabled: queryEnabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous ?? 0,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationsAPI.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationsAPI.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
    },
  });
}

export function useCreateNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notification: {
      user_id: string;
      organization_id: string;
      title: string;
      content?: string;
      type?: string;
      lead_id?: string;
    }) => notificationsAPI.create(notification),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
    },
  });
}
