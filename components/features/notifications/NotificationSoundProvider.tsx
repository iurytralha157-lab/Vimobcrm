'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useNewLeadSound } from '@/hooks/notifications/use-new-lead-sound';

const NotificationSoundContext = createContext<ReturnType<typeof useNewLeadSound> | null>(null);

export function NotificationSoundProvider({ children }: { children: ReactNode }) {
  const sound = useNewLeadSound();
  return <NotificationSoundContext.Provider value={sound}>{children}</NotificationSoundContext.Provider>;
}

export function useNotificationSound() {
  return useContext(NotificationSoundContext);
}
