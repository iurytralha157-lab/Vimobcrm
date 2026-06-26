import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface TelephonyCall {
  id: string;
  organization_id: string;
  lead_id: string | null;
  user_id: string | null;
  external_call_id: string | null;
  direction: 'inbound' | 'outbound';
  phone_from: string | null;
  phone_to: string | null;
  status: string;
  outcome: string | null;
  initiated_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  talk_time_seconds: number | null;
  recording_url: string | null;
  recording_status: string | null;
  recording_storage_path: string | null;
  recording_duration_sec: number | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user?: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  lead?: {
    id: string;
    name: string;
  };
}

// These hooks interact with the telephony_calls table

export function useLeadCalls(leadId: string | null) {
  return useQuery({
    queryKey: ['telephony-calls', 'lead', leadId],
    queryFn: async () => {
      if (!leadId) return [] as TelephonyCall[];
      return [] as TelephonyCall[];
    },
    enabled: !!leadId,
  });
}

export function useUserCalls(userId?: string, options?: {
  startDate?: Date;
  endDate?: Date;
  status?: string;
}) {
  const { user } = useAuth();
  const targetUserId = userId || user?.id;

  return useQuery({
    queryKey: ['telephony-calls', 'user', targetUserId, options],
    queryFn: async () => {
      // Table doesn't exist - return empty array
      return [] as TelephonyCall[];
    },
    enabled: !!targetUserId,
  });
}

export function useOrganizationCalls(options?: {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  teamId?: string;
  pipelineId?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['telephony-calls', 'organization', options],
    queryFn: async () => {
      // Table doesn't exist - return empty array
      return [] as TelephonyCall[];
    },
  });
}

export interface TelephonyMetrics {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  outboundCalls: number;
  inboundCalls: number;
  talkTimeTotal: number;
  talkTimeAvg: number;
  durationTotal: number;
  durationAvg: number;
  answerRate: number;
}

export function useTelephonyMetrics(options?: {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  teamId?: string;
}) {
  return useQuery({
    queryKey: ['telephony-metrics', options],
    queryFn: async () => {
      // Return empty metrics
      const metrics: TelephonyMetrics = {
        totalCalls: 0,
        answeredCalls: 0,
        missedCalls: 0,
        outboundCalls: 0,
        inboundCalls: 0,
        talkTimeTotal: 0,
        talkTimeAvg: 0,
        durationTotal: 0,
        durationAvg: 0,
        answerRate: 0,
      };
      return metrics;
    },
  });
}

export interface BrokerTelephonyRanking {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  totalCalls: number;
  answeredCalls: number;
  talkTimeTotal: number;
  talkTimeAvg: number;
  answerRate: number;
}

export function useTelephonyRanking(options?: {
  startDate?: Date;
  endDate?: Date;
  teamId?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['telephony-ranking', options],
    queryFn: async () => {
      // Return empty ranking
      return [] as BrokerTelephonyRanking[];
    },
  });
}

export function useRecordingUrl() {
  return useMutation({
    mutationFn: async (callId: string) => {
      void callId;
      // Placeholder - would fetch from edge function
      throw new Error('Recording feature not available');
    },
  });
}

export function useCreateCall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      lead_id?: string;
      phone_to: string;
      direction?: 'inbound' | 'outbound';
      notes?: string;
      organization_id?: string;
    }) => {
      void data;
      throw new Error('Telephony feature not available');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telephony-calls'] });
    },
  });
}

export function useUpdateCall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<TelephonyCall> & { id: string }) => {
      void id;
      void data;
      // Table doesn't exist - throw error
      throw new Error('Telephony feature not available');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telephony-calls'] });
    },
  });
}

// Helper to format duration
export function formatCallDuration(seconds: number | null): string {
  if (!seconds) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Helper to format total time (for metrics)
export function formatTotalTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
