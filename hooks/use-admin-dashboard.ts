import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '@/lib/api/admin';

export type DashboardPeriod = 7 | 30 | 90 | 365;

export interface DashboardOverview {
  period_days: number;
  financial: {
    mrr: number;
    revenue_period: number;
    revenue_forecast: number;
    avg_ticket: number;
    overdue_total: number;
    revenue_growth_pct: number;
  };
  platform: {
    total_orgs: number;
    active_orgs: number;
    trial_orgs: number;
    cancelled_orgs: number;
    active_users_today: number;
    orgs_growth_pct: number;
  };
  operational: {
    leads_today: number;
    automations_today: number;
    activities_today: number;
    errors_recent: number;
    accesses_today: number;
  };
}

export interface DashboardTimeseries {
  revenue: Array<{ date: string; value: number }>;
  orgs: Array<{ date: string; created: number; trial: number; cancelled: number }>;
  usage: Array<{ date: string; leads: number; accesses: number; automations: number }>;
  health: { active: number; trial: number; overdue: number; cancelled: number };
}

export interface DashboardPendingBoards {
  overdue: Array<{ id: string; name: string; oldest_due: string; days_overdue: number; amount_due: number }>;
  idle: Array<{ id: string; name: string; last_access_at: string | null; days_idle: number | null }>;
  issues: Array<{ id: string; organization_id: string | null; organization_name: string | null; type: string; severity: string; title: string; description: string | null; created_at: string }>;
  trials: Array<{ id: string; name: string; trial_ends_at: string; days_left: number; telefone: string | null; whatsapp: string | null; email: string | null }>;
}

export interface FeedEvent {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'error' | 'critical';
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function useDashboardOverview(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['admin-dashboard-overview', period],
    queryFn: async (): Promise<DashboardOverview | null> => {
      return (await adminAPI.dashboardOverview(period)) as unknown as DashboardOverview;
    },
    staleTime: 60_000,
  });
}

export function useDashboardTimeseries(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['admin-dashboard-timeseries', period],
    queryFn: async (): Promise<DashboardTimeseries | null> => {
      return (await adminAPI.dashboardTimeseries(period)) as unknown as DashboardTimeseries;
    },
    staleTime: 60_000,
  });
}

export function useDashboardPendingBoards() {
  return useQuery({
    queryKey: ['admin-dashboard-pending'],
    queryFn: async (): Promise<DashboardPendingBoards | null> => {
      return (await adminAPI.dashboardPending()) as unknown as DashboardPendingBoards;
    },
    staleTime: 60_000,
  });
}

export function useDashboardFeed(limit = 30) {
  return useQuery({
    queryKey: ['admin-dashboard-feed', limit],
    queryFn: async (): Promise<FeedEvent[]> => {
      return (await adminAPI.dashboardFeed(limit)) as unknown as FeedEvent[];
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
