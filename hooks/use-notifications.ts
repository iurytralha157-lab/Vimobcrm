import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notificationsAPI } from '@/lib/api/notifications';
import type { NotificationCategory } from '@/lib/validation/notification-filters';

export type { Notification } from '@/lib/api/notifications';

const NOTIFICATIONS_INITIAL_LOAD_DELAY_MS = 2500;
const NOTIFICATIONS_PAGE_SIZE = 25;

function useDelayedQueryEnabled(enabledKey: string | null, delayMs = NOTIFICATIONS_INITIAL_LOAD_DELAY_MS) {
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!enabledKey) return undefined;

    const timeout = setTimeout(() => setReadyKey(enabledKey), delayMs);
    return () => clearTimeout(timeout);
  }, [delayMs, enabledKey]);

  return enabledKey !== null && readyKey === enabledKey;
}

export function useNotifications(filters: { unreadOnly?: boolean; categories?: NotificationCategory[] } = {}) {
  const { activeOrganization, profile } = useAuth();
  const queryEnabled = useDelayedQueryEnabled(
    profile?.id && activeOrganization.organizationId ? `${profile.id}:${activeOrganization.organizationId}` : null,
  );

  const query = useInfiniteQuery({
    queryKey: ['notifications', profile?.id, activeOrganization.organizationId, NOTIFICATIONS_PAGE_SIZE, Boolean(filters.unreadOnly), [...(filters.categories ?? [])].sort()],
    queryFn: ({ pageParam, signal }) => notificationsAPI.list({
      userId: profile!.id,
      limit: NOTIFICATIONS_PAGE_SIZE,
      cursor: pageParam,
      unreadOnly: filters.unreadOnly,
      categories: filters.categories,
    }, { signal, expectedUserId: profile!.id, organizationId: activeOrganization.organizationId! }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: queryEnabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const notifications = useMemo(() => query.data?.pages.flatMap((page) => page.notifications) ?? [], [query.data]);

  return { ...query, data: notifications };
}

export function useUnreadNotificationsCount() {
  const { activeOrganization, profile } = useAuth();
  const queryEnabled = useDelayedQueryEnabled(
    profile?.id && activeOrganization.organizationId ? `${profile.id}:${activeOrganization.organizationId}` : null,
  );

  return useQuery({
    queryKey: ['unread-notifications-count', profile?.id, activeOrganization.organizationId],
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
