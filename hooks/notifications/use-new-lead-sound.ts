'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/hooks/use-notifications';
import type { NotificationPage } from '@/lib/api/notifications';
import { claimNewLeadSound } from '@/lib/notifications/lead-sound-coordinator';
import { createNewLeadSoundGate } from '@/lib/notifications/new-lead-sound-policy';
import {
  activateNewLeadAudio,
  isNewLeadAudioReady,
  isNewLeadSoundMuted,
  playNewLeadAudio,
  setNewLeadSoundMuted,
  subscribeNewLeadAudio,
  subscribeNewLeadSoundPreference,
} from '@/lib/notifications/new-lead-audio';

const NEW_LEAD_HINTS = new Set(['lead.created', 'lead.assigned', 'lead.redistributed', 'lead.meta_webhook_received', 'lead.updated']);
const serverMuted = () => true;
const serverReady = () => false;

export function useNewLeadSound() {
  const { activeOrganization, profile } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const userId = profile?.id ?? '';
  const queryClient = useQueryClient();
  // Shares the existing unfiltered query with the header; no parallel transport.
  useNotifications();
  const lifetime = useRef<{ scope: string; active: boolean } | null>(null);
  const getMuted = useCallback(() => isNewLeadSoundMuted(userId), [userId]);
  const muted = useSyncExternalStore(subscribeNewLeadSoundPreference, getMuted, serverMuted);
  const ready = useSyncExternalStore(subscribeNewLeadAudio, isNewLeadAudioReady, serverReady);

  useLayoutEffect(() => () => {
    // Fence old callbacks during the commit, before passive subscriptions clean up.
    if (lifetime.current) lifetime.current.active = false;
    lifetime.current = null;
  }, [organizationId, userId, queryClient]);

  useEffect(() => {
    if (!userId || !organizationId) return;
    const current = { scope: `${organizationId}:${userId}`, active: true };
    lifetime.current = current;
    const gate = createNewLeadSoundGate({ organizationId, userId }, Date.now());
    const eligible = () => current.active && lifetime.current === current
      && !isNewLeadSoundMuted(userId) && isNewLeadAudioReady();
    const matches = (key: readonly unknown[]) => key[0] === 'notifications'
      && key[1] === userId && key[2] === organizationId && key[4] === false
      && Array.isArray(key[5]) && key[5].length === 0;
    const process = (data: InfiniteData<NotificationPage> | undefined) => {
      // Only the latest page is an arrival source; older pagination stays quiet.
      const page = data?.pages[0]?.notifications;
      if (!current.active || !page) return;
      const candidates = gate(page, Date.now());
      if (!eligible()) return;
      for (const notification of candidates) {
        void claimNewLeadSound({ scope: current.scope, notificationId: notification.id, now: Date.now() }, eligible)
          .then((claimed) => { if (claimed && eligible()) return playNewLeadAudio(); })
          .catch(() => { /* Notification rendering is independent from audio. */ });
      }
    };
    queryClient.getQueryCache().findAll({ queryKey: ['notifications', userId, organizationId] })
      .filter((query) => matches(query.queryKey))
      .forEach((query) => process(query.state.data as InfiniteData<NotificationPage> | undefined));
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success' && matches(event.query.queryKey)) {
        process(event.query.state.data as InfiniteData<NotificationPage> | undefined);
      }
    });

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let lastHintRefresh = 0;
    const onLeadChange = (event: Event) => {
      const change = (event as CustomEvent<{ organizationId?: string; reason?: string }>).detail;
      if (!current.active || change?.organizationId !== organizationId || !NEW_LEAD_HINTS.has(change.reason ?? '') || refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        if (!current.active) return;
        lastHintRefresh = Date.now();
        for (const prefix of ['notifications', 'unread-notifications-count']) {
          void queryClient.invalidateQueries({ queryKey: [prefix, userId, organizationId], refetchType: 'active' }, { cancelRefetch: false });
        }
      }, Math.max(400, 2000 - (Date.now() - lastHintRefresh)));
    };
    const activate = () => { void activateNewLeadAudio(); };
    window.addEventListener('vimob:lead-realtime-change', onLeadChange);
    document.addEventListener('pointerdown', activate, { capture: true, passive: true });
    document.addEventListener('keydown', activate, { capture: true, passive: true });
    document.addEventListener('touchend', activate, { capture: true, passive: true });
    return () => {
      current.active = false;
      if (lifetime.current === current) lifetime.current = null;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
      window.removeEventListener('vimob:lead-realtime-change', onLeadChange);
      document.removeEventListener('pointerdown', activate, true);
      document.removeEventListener('keydown', activate, true);
      document.removeEventListener('touchend', activate, true);
    };
  }, [organizationId, userId, queryClient]);

  const onMutedChange = useCallback((value: boolean) => {
    if (!lifetime.current?.active || lifetime.current.scope !== `${organizationId}:${userId}`) return;
    setNewLeadSoundMuted(userId, value);
    if (!value) void activateNewLeadAudio();
  }, [organizationId, userId]);
  const onTest = useCallback(async () => {
    const current = lifetime.current;
    if (!current?.active || current.scope !== `${organizationId}:${userId}`) return false;
    const activated = await activateNewLeadAudio();
    if (!activated || !current.active || lifetime.current !== current) return false;
    const played = await playNewLeadAudio();
    return played && current.active && lifetime.current === current;
  }, [organizationId, userId]);

  return useMemo(() => ({ muted, ready, onMutedChange, onTest }), [muted, ready, onMutedChange, onTest]);
}
