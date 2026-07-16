import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { leadsAPI } from '@/lib/api/leads';
import { lostReasonSchema } from '@/lib/validation';
import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import type { Lead } from '@/hooks/use-leads';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { appendOptimisticHistoryEvent, invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';

interface ChangeDealStatusParams {
  leadId: string;
  newStatus: 'open' | 'won' | 'lost';
  organizationId: string;
  organizationName?: string | null;
  userId: string | null;
  propertyId: string | null;
  valorInteresse: number | null;
  commissionPercentage: number | null;
  leadName: string;
  lostReason?: string | null;
}

type DealStatus = ChangeDealStatusParams['newStatus'];

type MutationSnapshots = {
  stages: Array<[QueryKey, unknown]>;
  leads: Array<[QueryKey, unknown]>;
  leadDetails: Array<[QueryKey, unknown]>;
  history: Array<[QueryKey, unknown]>;
  previousStatus: DealStatus;
};

const statusLabels: Record<DealStatus, string> = {
  open: 'Aberto',
  won: 'Ganho',
  lost: 'Perdido',
};

function getQueryKeyDealStatusFilter(queryKey: QueryKey) {
  if (!Array.isArray(queryKey)) return null;
  const value = queryKey[7];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getStatusPatch(params: ChangeDealStatusParams, timestamp: string): Partial<Lead & PipelineLead> {
  return {
    deal_status: params.newStatus,
    lost_reason: params.newStatus === 'lost' ? params.lostReason || null : null,
    won_at: params.newStatus === 'won' ? timestamp : null,
    lost_at: params.newStatus === 'lost' ? timestamp : null,
    updated_at: timestamp,
  };
}

function findPreviousStatus(
  stageSnapshots: Array<[QueryKey, unknown]>,
  leadSnapshots: Array<[QueryKey, unknown]>,
  leadsSnapshots: Array<[QueryKey, unknown]>,
  leadId: string,
): DealStatus {
  for (const [, data] of stageSnapshots) {
    if (!Array.isArray(data)) continue;
    for (const stage of data as StageWithLeads[]) {
      const lead = stage.leads?.find((item) => item.id === leadId);
      if (lead?.deal_status === 'won' || lead?.deal_status === 'lost' || lead?.deal_status === 'open') {
        return lead.deal_status;
      }
    }
  }

  for (const [, data] of leadSnapshots) {
    const lead = data as Partial<Lead> | null | undefined;
    if (lead?.id !== leadId) continue;
    if (lead.deal_status === 'won' || lead.deal_status === 'lost' || lead.deal_status === 'open') {
      return lead.deal_status;
    }
  }

  for (const [, data] of leadsSnapshots) {
    if (!Array.isArray(data)) continue;
    const lead = (data as Partial<Lead>[]).find((item) => item?.id === leadId);
    if (lead?.deal_status === 'won' || lead?.deal_status === 'lost' || lead?.deal_status === 'open') {
      return lead.deal_status;
    }
  }

  return 'open';
}

function patchStageCache(
  current: StageWithLeads[] | undefined,
  queryKey: QueryKey,
  leadId: string,
  patch: Partial<PipelineLead>,
) {
  if (!Array.isArray(current)) return current;

  const dealStatusFilter = getQueryKeyDealStatusFilter(queryKey);
  const shouldKeepInFilteredView = !dealStatusFilter || dealStatusFilter === patch.deal_status;
  let changed = false;

  const nextStages = current.map((stage) => {
    if (!Array.isArray(stage.leads)) return stage;

    let stageChanged = false;
    const nextLeads = stage.leads.reduce<PipelineLead[]>((acc, lead) => {
      if (lead.id !== leadId) {
        acc.push(lead);
        return acc;
      }

      changed = true;
      stageChanged = true;
      if (!shouldKeepInFilteredView) return acc;

      acc.push({
        ...lead,
        ...patch,
        assignee: patch.assignee === undefined ? lead.assignee : patch.assignee,
        tags: patch.tags === undefined ? lead.tags : patch.tags,
        interest_property: patch.interest_property === undefined ? lead.interest_property : patch.interest_property,
      });
      return acc;
    }, []);

    if (!stageChanged) return stage;

    const totalLeadCount = Number(stage.total_lead_count ?? stage.leads.length);
    return {
      ...stage,
      leads: nextLeads,
      total_lead_count: shouldKeepInFilteredView ? totalLeadCount : Math.max(totalLeadCount - 1, 0),
      has_more: shouldKeepInFilteredView ? stage.has_more : totalLeadCount - 1 > nextLeads.length,
    };
  });

  return changed ? nextStages : current;
}

function patchLeadListCache(current: Lead[] | undefined, leadId: string, patch: Partial<Lead>) {
  if (!Array.isArray(current)) return current;
  let changed = false;
  const next = current.map((lead) => {
    if (lead.id !== leadId) return lead;
    changed = true;
    return {
      ...lead,
      ...patch,
      assignee: patch.assignee === undefined ? lead.assignee : patch.assignee,
      tags: patch.tags === undefined ? lead.tags : patch.tags,
      stage: patch.stage === undefined ? lead.stage : patch.stage,
    };
  });
  return changed ? next : current;
}

function patchLeadDetailCache(current: Lead | null | undefined, leadId: string, patch: Partial<Lead>) {
  if (!current || current.id !== leadId) return current;
  return {
    ...current,
    ...patch,
    assignee: patch.assignee === undefined ? current.assignee : patch.assignee,
    tags: patch.tags === undefined ? current.tags : patch.tags,
    stage: patch.stage === undefined ? current.stage : patch.stage,
  };
}

function optimisticHistoryEvent(
  params: ChangeDealStatusParams,
  previousStatus: DealStatus,
  timestamp: string,
): UnifiedHistoryEvent {
  return {
    id: `optimistic-status-${params.leadId}-${timestamp}`,
    type: 'status_change',
    label: `Status: ${statusLabels[previousStatus]} -> ${statusLabels[params.newStatus]}`,
    content: params.newStatus === 'lost' && params.lostReason ? `Motivo: ${params.lostReason}` : null,
    timestamp,
    actor: null,
    source: 'activity',
    metadata: {
      from_status: previousStatus,
      to_status: params.newStatus,
      lost_reason: params.newStatus === 'lost' ? params.lostReason || null : null,
    },
  };
}

function restoreSnapshots(queryClient: ReturnType<typeof useQueryClient>, snapshots?: MutationSnapshots) {
  if (!snapshots) return;

  [...snapshots.stages, ...snapshots.leads, ...snapshots.leadDetails, ...snapshots.history].forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
}

export function useDealStatusChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ChangeDealStatusParams) => {
      const { leadId, newStatus, lostReason } = params;
      const validatedLostReason = newStatus === 'lost'
        ? lostReasonSchema.parse(lostReason || '')
        : null;

      const updateData: TablesUpdate<'leads'> = {
        deal_status: newStatus,
        lost_reason: validatedLostReason,
      };
      if (params.propertyId && newStatus !== 'open') {
        updateData.property_id = params.propertyId;
        updateData.interest_property_id = params.propertyId;
      }

      const { data: lead, error } = await leadsAPI.updateLead(leadId, updateData, params.organizationId);

      if (error) throw error;
      if (!lead) throw new Error('API nao retornou o lead atualizado');

      return { lead, newStatus };
    },
    onMutate: async (variables): Promise<MutationSnapshots> => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['stages-with-leads'] }),
        queryClient.cancelQueries({ queryKey: ['leads'] }),
        queryClient.cancelQueries({ queryKey: ['lead'] }),
        queryClient.cancelQueries({ queryKey: ['lead-history-v2', variables.leadId] }),
      ]);

      const snapshots: MutationSnapshots = {
        stages: queryClient.getQueriesData({ queryKey: ['stages-with-leads'] }),
        leads: queryClient.getQueriesData({ queryKey: ['leads'] }),
        leadDetails: queryClient.getQueriesData({ queryKey: ['lead'] }),
        history: queryClient.getQueriesData({ queryKey: ['lead-history-v2', variables.leadId] }),
        previousStatus: 'open',
      };
      snapshots.previousStatus = findPreviousStatus(
        snapshots.stages,
        snapshots.leadDetails,
        snapshots.leads,
        variables.leadId,
      );

      const timestamp = new Date().toISOString();
      const patch = getStatusPatch(variables, timestamp);
      const historyEvent = optimisticHistoryEvent(variables, snapshots.previousStatus, timestamp);

      snapshots.stages.forEach(([queryKey]) => {
        queryClient.setQueryData<StageWithLeads[]>(queryKey, (current) =>
          patchStageCache(current, queryKey, variables.leadId, patch as Partial<PipelineLead>),
        );
      });
      snapshots.leads.forEach(([queryKey]) => {
        queryClient.setQueryData<Lead[]>(queryKey, (current) =>
          patchLeadListCache(current, variables.leadId, patch as Partial<Lead>),
        );
      });
      snapshots.leadDetails.forEach(([queryKey]) => {
        queryClient.setQueryData<Lead | null>(queryKey, (current) =>
          patchLeadDetailCache(current, variables.leadId, patch as Partial<Lead>),
        );
      });
      snapshots.history.forEach(([queryKey]) => {
        queryClient.setQueryData<UnifiedHistoryEvent[]>(queryKey, (current) =>
          appendOptimisticHistoryEvent(current, historyEvent),
        );
      });

      return snapshots;
    },
    onSuccess: ({ lead, newStatus }, variables) => {
      const serverPatch = lead ? { ...lead, deal_status: newStatus } as Partial<Lead & PipelineLead> : undefined;
      if (serverPatch) {
        queryClient.getQueriesData<StageWithLeads[]>({ queryKey: ['stages-with-leads'] }).forEach(([queryKey]) => {
          queryClient.setQueryData<StageWithLeads[]>(queryKey, (current) =>
            patchStageCache(current, queryKey, variables.leadId, serverPatch as Partial<PipelineLead>),
          );
        });
        queryClient.setQueriesData<Lead[]>({ queryKey: ['leads'] }, (current) =>
          patchLeadListCache(current, variables.leadId, serverPatch as Partial<Lead>),
        );
        queryClient.setQueriesData<Lead | null>({ queryKey: ['lead'] }, (current) =>
          patchLeadDetailCache(current, variables.leadId, serverPatch as Partial<Lead>),
        );
      }

      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'], refetchType: 'inactive' });
      queryClient.invalidateQueries({ queryKey: ['leads'], refetchType: 'inactive' });
      queryClient.invalidateQueries({ queryKey: ['lead'], refetchType: 'inactive' });
      invalidateLeadHistorySoon(queryClient, variables.leadId);
      queryClient.invalidateQueries({ queryKey: ['activities'], refetchType: 'inactive' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'], refetchType: 'inactive' });
      queryClient.invalidateQueries({ queryKey: ['enhanced-dashboard-stats'], refetchType: 'inactive' });

      if (newStatus === 'won') {
        queryClient.invalidateQueries({ queryKey: ['properties'], refetchType: 'inactive' });
        queryClient.invalidateQueries({ queryKey: ['properties-infinite'], refetchType: 'inactive' });
        queryClient.invalidateQueries({ queryKey: ['property'], refetchType: 'inactive' });
        queryClient.invalidateQueries({ queryKey: ['notifications'], refetchType: 'inactive' });
        queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'], refetchType: 'inactive' });
        if (variables.propertyId) {
          queryClient.invalidateQueries({
            queryKey: ['property', variables.organizationId, variables.propertyId],
            refetchType: 'inactive',
          });
        }

        toast.success('Negocio fechado!', {
          description: variables.valorInteresse
            ? `R$ ${variables.valorInteresse.toLocaleString('pt-BR')}`
            : undefined,
        });

      } else if (newStatus === 'lost') {
        toast.info('Lead marcado como perdido');
      } else {
        toast.info('Lead reaberto');
      }
    },
    onError: (error, _variables, context) => {
      restoreSnapshots(queryClient, context);
      toast.error(error instanceof Error ? error.message : 'Erro ao alterar status do negocio');
    },
  });
}
