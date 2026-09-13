import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  getPipelineLeadValue,
  patchPipelineLeadInBoard,
  pipelineLeadMatchesQueryKeyScope,
} from '@/lib/pipeline-board-cache';
import type { LeadDetailLead, PipelineCacheStage } from './types';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';

export type LeadDetailPipelineCacheSnapshot = Array<[QueryKey, unknown]>;

export function useLeadDetailPipelineCache() {
  const queryClient = useQueryClient();

  const updatePipelineAssigneeCache = (nextLead: LeadDetailLead) => {
    const snapshots = queryClient.getQueriesData<PipelineCacheStage[]>({
      queryKey: ['stages-with-leads'],
    });
    const nextUpdatedAt = new Date().toISOString();

    snapshots.forEach(([queryKey, cachedData]) => {
      if (!Array.isArray(cachedData)) return;

      const keyParts = Array.isArray(queryKey) ? queryKey : [];
      const shouldKeepInFilteredView = pipelineLeadMatchesQueryKeyScope(
        keyParts,
        nextLead,
      );

      let changed = false;
      const nextStages = cachedData.map((stage) => {
        if (!Array.isArray(stage?.leads)) return stage;

        let stageChanged = false;
        let removedValue = 0;
        const nextLeads = stage.leads.reduce<LeadDetailLead[]>((acc, stageLead) => {
          if (stageLead?.id !== nextLead.id) {
            acc.push(stageLead);
            return acc;
          }

          changed = true;
          stageChanged = true;

          if (!shouldKeepInFilteredView) {
            removedValue = getPipelineLeadValue(stageLead);
            return acc;
          }

          acc.push({
            ...stageLead,
            assigned_user_id: nextLead.assigned_user_id,
            assignee: nextLead.assignee || undefined,
            updated_at: nextUpdatedAt,
          });
          return acc;
        }, []);

        if (!stageChanged) return stage;

        const totalLeadCount = Number(stage.total_lead_count ?? stage.leads.length);
        const currentTotalValue = Number(stage.total_value);
        return {
          ...stage,
          leads: nextLeads,
          total_lead_count: shouldKeepInFilteredView
            ? totalLeadCount
            : Math.max(totalLeadCount - 1, 0),
          total_value:
            !shouldKeepInFilteredView && Number.isFinite(currentTotalValue)
              ? Math.max(currentTotalValue - removedValue, 0)
              : stage.total_value,
        };
      });

      if (changed) queryClient.setQueryData(queryKey, nextStages);
    });

    return snapshots;
  };

  const updatePipelineLeadCache = (
    leadIdToUpdate: string,
    patch: Partial<LeadDetailLead>,
  ) => {
    const snapshots = queryClient.getQueriesData<PipelineCacheStage[]>({
      queryKey: ['stages-with-leads'],
    });
    const nextUpdatedAt = new Date().toISOString();

    snapshots.forEach(([queryKey, cachedData]) => {
      if (!Array.isArray(cachedData)) return;

      const currentLead = cachedData
        .flatMap((stage) => stage.leads)
        .find((stageLead) => stageLead?.id === leadIdToUpdate);
      if (!currentLead) return;

      const nextLead: LeadDetailLead = {
        ...currentLead,
        ...patch,
        updated_at: nextUpdatedAt,
      };
      const nextStages = patchPipelineLeadInBoard<LeadDetailLead, PipelineCacheStage>(cachedData, leadIdToUpdate, nextLead, {
        keepInDestination: pipelineLeadMatchesQueryKeyScope(
          Array.isArray(queryKey) ? queryKey : [],
          nextLead,
        ),
        destinationIndex: 0,
      });

      if (nextStages !== cachedData) queryClient.setQueryData(queryKey, nextStages);
    });

    return snapshots;
  };

  const restorePipelineCache = (snapshots: LeadDetailPipelineCacheSnapshot) => {
    snapshots.forEach(([queryKey, data]) => {
      queryClient.setQueryData(queryKey, data);
    });
  };

  const refreshPipelineInBackground = (
    organizationId: string | null | undefined,
    leadId: string,
    reason: string,
  ) => {
    if (!organizationId) return;
    notifyLeadRealtimeChange({ organizationId, leadId, reason });
  };

  return {
    refreshPipelineInBackground,
    restorePipelineCache,
    updatePipelineAssigneeCache,
    updatePipelineLeadCache,
  };
}
