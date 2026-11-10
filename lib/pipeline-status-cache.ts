import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Lead } from '@/hooks/use-leads';
import type { PipelineLead } from '@/hooks/use-stages';
import {
  findPipelineLeadLocation,
  getPipelineLeadQueryScopeMatch,
  getPipelineLeadValue,
  patchPipelineLeadInBoard,
  type PipelineBoardStageLike,
} from '@/lib/pipeline-board-cache';
import { mergeLeadOperationCapability } from '@/lib/lead-operation-capability';
import { compareServerRevisions } from '@/lib/compare-server-revisions';
import { mergeLeadServerResponse } from '@/lib/merge-lead-server-response';

export type LeadStatusCachePatch = Omit<Partial<Lead>, 'stage' | 'assignee' | 'tags'> & {
  stage?: Lead['stage'] | PipelineLead['stage'];
  assignee?: Lead['assignee'] | PipelineLead['assignee'] | null;
  tags?: Lead['tags'] | PipelineLead['tags'];
  interest_property?: PipelineLead['interest_property'];
  lead_meta?: PipelineLead['lead_meta'];
};
type CacheLead = LeadStatusCachePatch & { id: string };
type CacheStage = PipelineBoardStageLike<CacheLead>;
type CacheKind = 'board' | 'list' | 'detail';
type CacheChange = {
  queryKey: QueryKey;
  queryHash: string;
  kind: CacheKind;
  before: CacheLead;
  after?: CacheLead;
  keys: Array<keyof CacheLead>;
  stageId?: string;
  leadIndex?: number;
  serverEpoch: number;
};
export type LeadStatusCacheRollback = {
  organizationId: string;
  leadId: string;
  changes: CacheChange[];
};

// A manual patch for B does not surrender A's optimistic removal. A completed
// authoritative board read does: its absence must never be undone by A's error.
const readEpochs = new WeakMap<QueryClient, Map<string, number>>();
function epochs(client: QueryClient) {
  let result = readEpochs.get(client);
  if (result) return result;
  result = new Map();
  readEpochs.set(client, result);
  const tracked = result;
  client.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') tracked.delete(event.query.queryHash);
    if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual) {
      tracked.set(event.query.queryHash, (tracked.get(event.query.queryHash) ?? 0) + 1);
    }
  });
  return result;
}

function matchesLead(lead: CacheLead | undefined, organizationId: string, leadId: string) {
  return lead?.id === leadId && (!lead.organization_id || lead.organization_id === organizationId);
}
function newerRevision(current: CacheLead, incoming: LeadStatusCachePatch) {
  return compareServerRevisions(current.updated_at, incoming.updated_at) === 1;
}
function cacheKind(key: QueryKey, organizationId: string, leadId: string, boardsOnly: boolean): CacheKind | null {
  if (key[1] !== organizationId) return null;
  if (key[0] === 'stages-with-leads') return 'board';
  if (boardsOnly) return null;
  if (key[0] === 'leads') return 'list';
  if (key[0] === 'lead' && key[2] === leadId) return 'detail';
  return null;
}
function leadIn(data: unknown, kind: CacheKind, leadId: string): CacheLead | undefined {
  if (kind === 'board') {
    return Array.isArray(data) ? findPipelineLeadLocation<CacheLead, CacheStage>(data as CacheStage[], leadId)?.lead : undefined;
  }
  if (kind === 'list') return Array.isArray(data) ? (data as CacheLead[]).find((lead) => lead.id === leadId) : undefined;
  return data && typeof data === 'object' ? data as CacheLead : undefined;
}

export function applyScopedLeadStatusPatch(
  client: QueryClient,
  organizationId: string,
  leadId: string,
  patch: LeadStatusCachePatch,
  options: { boardsOnly?: boolean; authoritative?: boolean } = {},
): LeadStatusCacheRollback {
  const changes: CacheChange[] = [];
  if (patch.organization_id && patch.organization_id !== organizationId) return { organizationId, leadId, changes };
  const reads = epochs(client);
  for (const query of client.getQueryCache().getAll()) {
    const kind = cacheKind(query.queryKey, organizationId, leadId, Boolean(options.boardsOnly));
    if (!kind) continue;
    const beforeData = query.state.data;
    const before = leadIn(beforeData, kind, leadId);
    if (!before || !matchesLead(before, organizationId, leadId)) continue;
    if (options.authoritative && newerRevision(before, patch)) continue;
    const next = options.authoritative
      ? mergeLeadServerResponse(before, { ...patch, id: leadId } as CacheLead)
      : mergeLeadOperationCapability<CacheLead>(before, { ...patch, id: leadId });
    const location = kind === 'board' ? findPipelineLeadLocation<CacheLead, CacheStage>(beforeData as CacheStage[], leadId) : null;
    let changed: unknown;
    if (kind === 'board') {
      let scopeMatch = getPipelineLeadQueryScopeMatch(query.queryKey, next);
      const terminalAt = next.deal_status === 'won' ? next.won_at : next.lost_at;
      if (options.authoritative && query.queryKey[14] !== 'origin' &&
        Number.isFinite(Date.parse(String(query.queryKey[4] ?? ''))) &&
        Number.isFinite(Date.parse(String(query.queryKey[5] ?? ''))) &&
        (next.deal_status === 'won' || next.deal_status === 'lost') && !terminalAt) {
        // The legacy single-lead DTO omits terminal dates. Its omission cannot
        // prove non-membership in an operational period; the board API can.
        const withoutDates = [...query.queryKey];
        withoutDates[4] = undefined;
        withoutDates[5] = undefined;
        scopeMatch = getPipelineLeadQueryScopeMatch(withoutDates, next) === 'mismatch' ? 'mismatch' : 'unknown';
      }
      if (scopeMatch === 'unknown') {
        void client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' });
        continue;
      }
      changed = patchPipelineLeadInBoard<CacheLead, CacheStage>(beforeData as CacheStage[], leadId, next, { scopeMatch });
    } else if (kind === 'list') {
      changed = (beforeData as CacheLead[]).map((lead) => lead.id === leadId ? next : lead);
    } else changed = next;
    const installed = client.setQueryData(query.queryKey, changed);
    const after = leadIn(installed, kind, leadId);
    const keys = (Object.keys(patch) as Array<keyof CacheLead>).filter((key) => !Object.is(before[key], after?.[key]));
    for (const key of ['can_operate', 'can_progress'] as const) {
      if (!Object.is(before[key], after?.[key]) && !keys.includes(key)) keys.push(key);
    }
    if (after === before) continue;
    changes.push({ queryKey: query.queryKey, queryHash: query.queryHash, kind, before, after, keys,
      stageId: location?.stageId, leadIndex: location?.leadIndex,
      serverEpoch: reads.get(query.queryHash) ?? 0 });
  }
  return { organizationId, leadId, changes };
}

function restoreFields(current: CacheLead, change: CacheChange) {
  if (!change.after || current.updated_at !== change.after.updated_at) return null;
  if (change.keys.some((key) => !Object.is(current[key], change.after?.[key]))) return null;
  const patch = Object.fromEntries(change.keys.map((key) => [key, change.before[key]])) as LeadStatusCachePatch;
  return { ...current, ...patch };
}
function insertRemovedLead(board: CacheStage[], change: CacheChange) {
  return board.map((stage) => {
    if (stage.id !== change.stageId) return stage;
    const leads = [...stage.leads];
    leads.splice(Math.min(change.leadIndex ?? 0, leads.length), 0, change.before);
    const count = Math.max(Number(stage.total_lead_count ?? stage.leads.length) + 1, leads.length);
    const value = Number(stage.total_value);
    return { ...stage, leads, total_lead_count: count,
      total_value: Number.isFinite(value) ? value + getPipelineLeadValue(change.before) : stage.total_value,
      has_more: count > leads.length };
  });
}

export function rollbackScopedLeadStatusPatch(client: QueryClient, rollback?: LeadStatusCacheRollback) {
  if (!rollback) return;
  const reads = epochs(client);
  const detail = client.getQueryData<CacheLead>(['lead', rollback.organizationId, rollback.leadId]);
  for (const change of rollback.changes) {
    if ((reads.get(change.queryHash) ?? 0) !== change.serverEpoch) continue;
    client.setQueryData(change.queryKey, (data: unknown) => {
      const current = leadIn(data, change.kind, rollback.leadId);
      if (!change.after && change.kind === 'board') {
        if (current || !Array.isArray(data)) return data;
        if (detail && detail.updated_at !== change.before.updated_at) return data;
        return insertRemovedLead(data as CacheStage[], change);
      }
      if (!matchesLead(current, rollback.organizationId, rollback.leadId) || !current) return data;
      const restored = restoreFields(current, change);
      if (!restored) return data;
      if (change.kind === 'board') return patchPipelineLeadInBoard<CacheLead, CacheStage>(data as CacheStage[], rollback.leadId, restored, { scopeMatch: 'match' });
      if (change.kind === 'list') return (data as CacheLead[]).map((lead) => lead.id === rollback.leadId ? restored : lead);
      return restored;
    });
  }
}

export function invalidateScopedLeadStatus(client: QueryClient, organizationId: string, leadId: string, refetch = false) {
  const refetchType = refetch ? 'active' as const : 'none' as const;
  void client.invalidateQueries({ queryKey: ['stages-with-leads', organizationId], refetchType });
  void client.invalidateQueries({ queryKey: ['leads', organizationId], refetchType });
  void client.invalidateQueries({ queryKey: ['lead', organizationId, leadId], exact: true, refetchType });
}
