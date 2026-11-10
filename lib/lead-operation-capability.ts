import { hasVerifiedLeadReadInCache, type VerifiedLeadRead } from '@/lib/lead-read-snapshot';

type LeadCapabilityFields = {
  id?: string;
  organization_id?: string | null;
  can_operate?: boolean;
  can_progress?: boolean;
  assigned_user_id?: string | null;
  team_id?: string | null;
};

// Write responses may omit capabilities. Keep a read capability only while
// its owner/team context is unchanged; a transfer must wait for a fresh GET.
export function mergeLeadOperationCapability<T extends LeadCapabilityFields>(
  current: T | null | undefined,
  incoming: Omit<T, 'can_operate' | 'can_progress'> & Pick<LeadCapabilityFields, 'can_operate' | 'can_progress'>,
): T {
  const merged = { ...current, ...incoming } as T;
  const scopeChanged = Boolean(current) && (
    (Object.hasOwn(incoming, 'assigned_user_id') && incoming.assigned_user_id !== current?.assigned_user_id) ||
    (Object.hasOwn(incoming, 'team_id') && incoming.team_id !== current?.team_id)
  );

  return {
    ...merged,
    can_operate: incoming.can_operate ?? (scopeChanged ? undefined : current?.can_operate),
    ...((Object.hasOwn(incoming, 'can_progress') || (current && Object.hasOwn(current, 'can_progress')))
      ? { can_progress: incoming.can_progress ?? (scopeChanged ? undefined : current?.can_progress) }
      : {}),
  };
}

export function leadProgressCapability(lead?: LeadCapabilityFields | null): boolean | undefined {
  return lead?.can_progress ?? lead?.can_operate;
}

export function canOperateLeadFromFreshRead(
  hasLeadOperatePermission: boolean,
  freshRead: {
    isSuccess: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    dataUpdatedAt?: number;
    data?: LeadCapabilityFields | null;
  },
  verifiedRead?: VerifiedLeadRead,
  action: 'operate' | 'progress' = 'operate',
): boolean {
  const verifiedBeforeMount = hasVerifiedLeadReadInCache(verifiedRead, {
    data: freshRead.data,
    dataUpdatedAt: freshRead.dataUpdatedAt,
    organizationId: freshRead.data?.organization_id,
    leadId: freshRead.data?.id,
  });
  return hasLeadOperatePermission &&
    freshRead.isSuccess &&
    (freshRead.isFetchedAfterMount || verifiedBeforeMount) &&
    !freshRead.isFetching &&
    (action === 'progress' ? leadProgressCapability(freshRead.data) : freshRead.data?.can_operate) === true;
}
