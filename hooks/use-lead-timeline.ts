import { useQuery } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type LeadTimelineRow = {
  id: string;
  organization_id: string;
  lead_id: string;
  event_type: string;
  user_id?: string | null;
  actor_user_id?: string | null;
  created_at: string;
  event_at?: string | null;
  channel?: string | null;
  is_automation?: boolean | null;
  metadata: Json | null;
  actor?: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
};

export interface LeadTimelineMetadata {
  source?: string;
  response_seconds?: number;
  old_stage_name?: string;
  new_stage_name?: string;
  elapsed_seconds?: number;
  [key: string]: unknown;
}

function normalizeMetadata(metadata: Json | null): LeadTimelineMetadata | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as LeadTimelineMetadata;
  }

  return null;
}

export interface LeadTimelineEvent {
  id: string;
  organization_id: string;
  lead_id: string;
  event_type: string;
  event_at: string;
  actor_user_id: string | null;
  channel: string | null;
  is_automation: boolean;
  metadata: LeadTimelineMetadata | null;
  created_at: string;
  actor?: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
}

export function useLeadTimeline(leadId: string | null) {
  return useQuery({
    queryKey: ['lead-timeline', leadId],
    queryFn: async (): Promise<LeadTimelineEvent[]> => {
      if (!leadId) return [];

      const events = await leadsAPI.getLeadTimeline<LeadTimelineRow>(leadId);

      return events.map((event) => ({
        ...event,
        event_at: event.event_at || event.created_at,
        actor_user_id: event.actor_user_id || event.user_id || null,
        channel: event.channel || null,
        is_automation: Boolean(event.is_automation),
        metadata: normalizeMetadata(event.metadata),
      })) as LeadTimelineEvent[];
    },
    enabled: !!leadId
  });
}

export interface FirstResponseMetrics {
  average: number;
  median: number;
  count: number;
  withinSla: number;
  slaPercentage: number;
}

export interface FirstResponseFilters {
  userId?: string;
  pipelineId?: string;
  dateFrom?: string;
  dateTo?: string;
  slaSeconds?: number; // Default 600 (10 minutes)
}

// Query real first response metrics from leads table
export function useFirstResponseMetrics(filters: FirstResponseFilters = {}) {
  return useQuery({
    queryKey: ['first-response-metrics', filters],
    queryFn: async (): Promise<FirstResponseMetrics> => {
      return leadsAPI.getFirstResponseMetrics<FirstResponseMetrics>(filters);
    }
  });
}

export interface UserFirstResponseRanking {
  userId: string;
  userName: string;
  userAvatar: string | null;
  average: number;
  median: number;
  count: number;
  slaPercentage: number;
}

// Query real first response ranking from leads table
export function useFirstResponseRanking(filters: Omit<FirstResponseFilters, 'userId'> = {}) {
  return useQuery({
    queryKey: ['first-response-ranking', filters],
    queryFn: async (): Promise<UserFirstResponseRanking[]> => {
      return leadsAPI.getFirstResponseRanking<UserFirstResponseRanking>(filters);
    }
  });
}

// Helper function to format seconds to human-readable
export function formatResponseTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
