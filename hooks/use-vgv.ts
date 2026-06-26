import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { analyticsAPI } from '@/lib/api/analytics';

export interface VGVStats {
  totalVGV: number;
  wonVGV: number;
  openVGV: number;
  lostVGV: number;
  totalLeads: number;
  wonLeads: number;
  openLeads: number;
  lostLeads: number;
}

export interface VGVByBroker {
  user_id: string;
  user_name: string;
  user_avatar: string | null;
  won_count: number;
  won_vgv: number;
  open_count: number;
  open_vgv: number;
  total_commission: number;
}

export interface StageVGV {
  stageId: string;
  totalVGV: number;
  openVGV: number;
  wonVGV: number;
  leadsCount: number;
}

export function useVGVStats(filters?: {
  dateFrom?: Date;
  dateTo?: Date;
  userId?: string;
  pipelineId?: string;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['vgv-stats', filters, user?.id],
    enabled: !!user?.id,
    queryFn: () =>
      analyticsAPI.vgvStats<VGVStats>({
        dateFrom: filters?.dateFrom?.toISOString(),
        dateTo: filters?.dateTo?.toISOString(),
        userId: filters?.userId,
        pipelineId: filters?.pipelineId,
      }),
  });
}

export function useVGVByBroker(filters?: {
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['vgv-by-broker', filters, user?.id],
    enabled: !!user?.id,
    queryFn: () =>
      analyticsAPI.vgvByBroker<VGVByBroker>({
        dateFrom: filters?.dateFrom?.toISOString(),
        dateTo: filters?.dateTo?.toISOString(),
      }),
  });
}

export function useStageVGV(pipelineId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['stage-vgv', pipelineId, user?.id],
    enabled: !!pipelineId && !!user?.id,
    queryFn: () => analyticsAPI.stageVGV<StageVGV>({ pipelineId }),
  });
}
