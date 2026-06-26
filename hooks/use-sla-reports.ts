import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { analyticsAPI } from "@/lib/api/analytics";

export interface SlaPerformanceByUser {
  user_id: string;
  user_name: string;
  total_leads: number;
  responded_in_time: number;
  responded_late: number;
  pending_response: number;
  overdue_count: number;
  avg_response_seconds: number | null;
  avg_first_touch_seconds: number | null;
  sla_compliance_rate: number | null;
}

export interface SlaFilters {
  startDate?: Date;
  endDate?: Date;
  pipelineId?: string | null;
}

export function useSlaPerformanceByUser(filters?: SlaFilters) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["sla-performance-by-user", filters],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      return analyticsAPI.slaPerformanceByUser<SlaPerformanceByUser>({
        startDate: filters?.startDate?.toISOString(),
        endDate: filters?.endDate?.toISOString(),
        pipelineId: filters?.pipelineId,
      });
    },
    enabled: !!profile?.organization_id,
  });
}

export interface SlaSummary {
  totalPending: number;
  totalWarning: number;
  totalOverdue: number;
  avgResponseTime: number | null;
  slaComplianceRate: number | null;
}

export function useSlaSummary(pipelineId?: string | null) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["sla-summary", pipelineId],
    queryFn: async (): Promise<SlaSummary> => {
      if (!profile?.organization_id) {
        return {
          totalPending: 0,
          totalWarning: 0,
          totalOverdue: 0,
          avgResponseTime: null,
          slaComplianceRate: null,
        };
      }

      return analyticsAPI.slaSummary<SlaSummary>({ pipelineId });
    },
    enabled: !!profile?.organization_id,
  });
}

export function formatSlaTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "-";

  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}
