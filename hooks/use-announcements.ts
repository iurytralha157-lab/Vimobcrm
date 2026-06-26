import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { adminAPI } from '@/lib/api/admin';

export type AnnouncementTargetType = 'all' | 'brokers' | 'specific' | 'organizations' | 'admins';

export interface Announcement {
  id: string;
  message: string;
  button_text: string | null;
  button_url: string | null;
  is_active: boolean;
  show_banner: boolean;
  send_notification: boolean;
  target_type: AnnouncementTargetType | string;
  target_organization_ids: string[] | null;
  target_user_ids: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  display_duration_seconds: number | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
}

interface PublishAnnouncementParams {
  message: string;
  buttonText?: string;
  buttonUrl?: string;
  showBanner?: boolean;
  sendNotification?: boolean;
  targetType?: AnnouncementTargetType;
  targetOrganizationIds?: string[];
  targetUserIds?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
  displayDurationSeconds?: number | null;
}

const BROKER_ROLES = new Set(['corretor', 'broker', 'agent', 'user']);

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Erro desconhecido';
}

function isWithinSchedule(announcement: Announcement, now = new Date()) {
  const startsAt = announcement.starts_at ? new Date(announcement.starts_at) : null;
  const endsAt = announcement.ends_at ? new Date(announcement.ends_at) : null;

  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

function isAnnouncementTargeted(
  announcement: Announcement,
  currentUserId?: string,
  currentRole?: string | null,
  currentOrgId?: string | null,
) {
  if (announcement.target_type === 'all') return true;
  if (announcement.target_type === 'admins') return currentRole === 'admin' || currentRole === 'super_admin';
  if (announcement.target_type === 'brokers') return BROKER_ROLES.has((currentRole || '').toLowerCase());
  if (announcement.target_type === 'organizations') {
    return !!currentOrgId && (announcement.target_organization_ids || []).includes(currentOrgId);
  }
  if (announcement.target_type === 'specific') {
    return !!currentUserId && (announcement.target_user_ids || []).includes(currentUserId);
  }
  return false;
}

export function useActiveAnnouncements() {
  const { profile, organization } = useAuth();

  return useQuery({
    queryKey: ['active-announcements', profile?.id, profile?.role, organization?.id],
    queryFn: async () => {
      const data = await adminAPI.listActiveAnnouncements<Announcement>();
      const currentUserId = profile?.id;
      const currentOrgId = organization?.id || profile?.organization_id;
      const currentRole = profile?.role;
      const now = new Date();

      return data
        .filter((announcement) => isWithinSchedule(announcement, now))
        .filter((announcement) => isAnnouncementTargeted(announcement, currentUserId, currentRole, currentOrgId));
    },
    enabled: !!profile?.id,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });
}

export function useActiveAnnouncement() {
  const query = useActiveAnnouncements();
  return {
    ...query,
    data: query.data?.[0] || null,
  };
}

export function useAnnouncements() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const { data: allAnnouncements = [], isLoading: isLoadingAll } = useQuery({
    queryKey: ['all-announcements'],
    queryFn: async () => {
      const items = await adminAPI.listTableRows('announcements', 50);
      return items as unknown as Announcement[];
    },
  });

  const currentAnnouncement = allAnnouncements.find((announcement) => announcement.is_active) || null;

  const publishMutation = useMutation({
    mutationFn: async (params: PublishAnnouncementParams) => {
      return adminAPI.createTableRow<Announcement>('announcements', {
        message: params.message,
        button_text: params.buttonText || null,
        button_url: params.buttonUrl || null,
        is_active: true,
        show_banner: params.showBanner ?? true,
        send_notification: params.sendNotification ?? false,
        target_type: params.targetType || 'all',
        target_organization_ids: params.targetOrganizationIds?.length ? params.targetOrganizationIds : null,
        target_user_ids: params.targetUserIds?.length ? params.targetUserIds : null,
        starts_at: params.startsAt || null,
        ends_at: params.endsAt || null,
        display_duration_seconds: params.displayDurationSeconds || null,
        created_by: profile?.id || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['active-announcement'] });
      queryClient.invalidateQueries({ queryKey: ['all-announcements'] });
      toast.success('Comunicado publicado!');
    },
    onError: (error: unknown) => {
      toast.error('Erro ao publicar: ' + getErrorMessage(error));
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (announcementId: string) => {
      return adminAPI.updateTableRow<Announcement>('announcements', announcementId, { is_active: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['active-announcement'] });
      queryClient.invalidateQueries({ queryKey: ['all-announcements'] });
      toast.success('Comunicado desativado!');
    },
    onError: (error: unknown) => {
      toast.error('Erro ao desativar: ' + getErrorMessage(error));
    },
  });

  return {
    currentAnnouncement,
    allAnnouncements,
    isLoading: isLoadingAll,
    publish: publishMutation,
    deactivate: deactivateMutation,
  };
}
