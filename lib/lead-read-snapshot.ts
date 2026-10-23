export type LeadReadIdentity = {
  id: string;
  organization_id?: string | null;
  assigned_user_id?: string | null;
  team_id?: string | null;
  can_operate?: boolean;
};

export type VerifiedLeadRead<T extends LeadReadIdentity = LeadReadIdentity> = {
  data: T;
  organizationId: string;
  selectionVersion: number;
  visibilityScopeKey: string;
  confirmedAt: number;
};

export const LEAD_READ_HANDOFF_MAX_AGE_MS = 30_000;

// Only the result of the current selection's GET can be handed to the dialog.
// The board's cached card and a timestamp alone are not access confirmation.
export function matchesVerifiedLeadReadScope(
  read: VerifiedLeadRead | null | undefined,
  scope: {
    organizationId?: string | null;
    leadId?: string | null;
    selectionVersion: number;
    visibilityScopeKey: string;
  },
): boolean {
  return Boolean(read && scope.organizationId && scope.leadId &&
    read.organizationId === scope.organizationId &&
    read.data.organization_id === scope.organizationId &&
    read.data.id === scope.leadId &&
    read.selectionVersion === scope.selectionVersion &&
    read.visibilityScopeKey === scope.visibilityScopeKey &&
    Number.isFinite(read.confirmedAt) && read.confirmedAt > 0);
}

export function hasVerifiedLeadReadInCache(
  read: VerifiedLeadRead | null | undefined,
  cache: {
    data?: Partial<LeadReadIdentity> | null;
    dataUpdatedAt?: number;
    organizationId?: string | null;
    leadId?: string | null;
  },
): boolean {
  const data = cache.data;
  return Boolean(read && data && cache.organizationId && cache.leadId &&
    read.organizationId === cache.organizationId &&
    read.data.organization_id === cache.organizationId &&
    read.data.id === cache.leadId &&
    data.organization_id === cache.organizationId &&
    data.id === cache.leadId &&
    Number.isFinite(read.confirmedAt) && read.confirmedAt > 0 &&
    Number.isFinite(cache.dataUpdatedAt) && cache.dataUpdatedAt! >= read.confirmedAt &&
    (data.assigned_user_id ?? null) === (read.data.assigned_user_id ?? null) &&
    (data.team_id ?? null) === (read.data.team_id ?? null) &&
    data.can_operate === read.data.can_operate);
}

export function canReuseLeadReadOnMount(
  read: VerifiedLeadRead | null | undefined,
  cache: Parameters<typeof hasVerifiedLeadReadInCache>[1],
  now = Date.now(),
): boolean {
  return hasVerifiedLeadReadInCache(read, cache) && Boolean(read &&
    now >= read.confirmedAt && now - read.confirmedAt <= LEAD_READ_HANDOFF_MAX_AGE_MS);
}
