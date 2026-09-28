type LeadCapabilityFields = {
  can_operate?: boolean;
  assigned_user_id?: string | null;
  team_id?: string | null;
};

// Write responses currently omit can_operate. Keep a read capability only while
// its owner/team context is unchanged; a transfer must wait for a fresh GET.
export function mergeLeadOperationCapability<T extends LeadCapabilityFields>(
  current: T | null | undefined,
  incoming: Omit<T, 'can_operate'> & { can_operate?: boolean },
): T {
  const merged = { ...current, ...incoming } as T;
  if (typeof incoming.can_operate === 'boolean') return merged;

  const scopeChanged = Boolean(current) && (
    (Object.hasOwn(incoming, 'assigned_user_id') && incoming.assigned_user_id !== current?.assigned_user_id) ||
    (Object.hasOwn(incoming, 'team_id') && incoming.team_id !== current?.team_id)
  );

  return {
    ...merged,
    can_operate: scopeChanged ? undefined : current?.can_operate,
  };
}

export function canOperateLeadFromFreshRead(
  hasLeadOperatePermission: boolean,
  freshRead: {
    isSuccess: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    data?: LeadCapabilityFields | null;
  },
): boolean {
  return hasLeadOperatePermission &&
    freshRead.isSuccess &&
    freshRead.isFetchedAfterMount &&
    !freshRead.isFetching &&
    freshRead.data?.can_operate === true;
}
