import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notificationsAPI } from '@/lib/api/notifications';

export type { Notification } from '@/lib/api/notifications';

let globalAudioContext: AudioContext | null = null;
let audioInitialized = false;

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

export function useNotifications() {
  const { profile, organization } = useAuth();
  const audioSetupDone = useRef(false);

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

  const query = useQuery({
    queryKey: ['notifications', profile?.id, organization?.id],
    queryFn: () => notificationsAPI.list({ userId: profile!.id, limit: 50 }),
    enabled: !!profile?.id && !!organization?.id,
    refetchInterval: 15000,
  });

  return {
    ...query,
    playNotificationSound,
  };
}

export function useUnreadNotificationsCount() {
  const { profile, organization } = useAuth();

  return useQuery({
    queryKey: ['unread-notifications-count', profile?.id, organization?.id],
    queryFn: async () => {
      const response = await notificationsAPI.unreadCount(profile!.id);
      return response.count || 0;
    },
    enabled: !!profile?.id && !!organization?.id,
    refetchInterval: 15000,
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
