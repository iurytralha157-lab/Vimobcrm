import { useLayoutEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import type { LeadDetailLead } from './types';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { applyScopedLeadStatusPatch, rollbackScopedLeadStatusPatch,
  type LeadStatusCachePatch, type LeadStatusCacheRollback } from '@/lib/pipeline-status-cache';

export type LeadDetailPipelineCacheSnapshot = Array<[QueryKey, unknown]>;
const rollbackBySnapshot = new WeakMap<LeadDetailPipelineCacheSnapshot, LeadStatusCacheRollback>();

export function useLeadDetailPipelineCache() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const scope = useRef({ organizationId, client: queryClient });
  useLayoutEffect(() => { scope.current = { organizationId, client: queryClient }; }, [organizationId, queryClient]);

  const updatePipelineLeadCache = (leadId: string, patch: Partial<LeadDetailLead>) => {
    const organizationId = scope.current.organizationId;
    if (!organizationId || scope.current.client !== queryClient ||
      (patch.organization_id && patch.organization_id !== organizationId)) return [];
    const snapshots = queryClient.getQueriesData({ queryKey: ['stages-with-leads', organizationId] });
    const rollback = applyScopedLeadStatusPatch(queryClient, organizationId, leadId,
      patch as LeadStatusCachePatch, { boardsOnly: true, authoritative: Boolean(patch.updated_at) });
    rollbackBySnapshot.set(snapshots, rollback);
    return snapshots;
  };

  const updatePipelineAssigneeCache = (nextLead: LeadDetailLead) => updatePipelineLeadCache(nextLead.id, {
    organization_id: nextLead.organization_id,
    assigned_user_id: nextLead.assigned_user_id,
    assignee: nextLead.assignee || undefined,
    can_operate: undefined,
    can_progress: undefined,
  });

  const restorePipelineCache = (snapshots: LeadDetailPipelineCacheSnapshot) => {
    const rollback = rollbackBySnapshot.get(snapshots);
    rollbackBySnapshot.delete(snapshots);
    if (!rollback || rollback.organizationId !== scope.current.organizationId || scope.current.client !== queryClient) return;
    rollbackScopedLeadStatusPatch(queryClient, rollback);
    // A fresh read may have superseded the optimistic patch. Always reconcile;
    // never replace a board with the old whole-query snapshot.
    void queryClient.invalidateQueries({ queryKey: ['stages-with-leads', rollback.organizationId], refetchType: 'active' });
  };

  const refreshPipelineInBackground = (organizationId: string | null | undefined, leadId: string, reason: string) => {
    if (!organizationId || scope.current.organizationId !== organizationId || scope.current.client !== queryClient) return;
    notifyLeadRealtimeChange({ organizationId, leadId, reason });
  };
  return { refreshPipelineInBackground, restorePipelineCache, updatePipelineAssigneeCache, updatePipelineLeadCache };
}
