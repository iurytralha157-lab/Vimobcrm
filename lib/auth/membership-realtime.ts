export const MEMBERSHIP_ACCESS_CHANGED_EVENT = 'access.membership.changed' as const;

type MembershipRealtimeEvent = {
  type: string;
  organizationId: string;
  userId?: string;
  data?: Record<string, unknown>;
};

export type MembershipAccessChange = {
  organizationId: string;
  targetUserId: string;
  isActive: boolean | null;
  deleted: boolean;
  revoked: boolean;
};

export function getTargetedMembershipAccessChange(
  event: MembershipRealtimeEvent,
  currentUserId: string,
  currentOrganizationId: string,
): MembershipAccessChange | null {
  if (
    event.type !== MEMBERSHIP_ACCESS_CHANGED_EVENT
    || event.organizationId !== currentOrganizationId
  ) {
    return null;
  }

  const targetUserId = getString(event.data, 'targetUserId') || event.userId;
  if (!targetUserId || targetUserId !== currentUserId) {
    return null;
  }

  const isActive = getBoolean(event.data, 'isActive');
  const deleted = getBoolean(event.data, 'deleted') === true;
  const explicitRevoked = getBoolean(event.data, 'revoked');

  return {
    organizationId: event.organizationId,
    targetUserId,
    isActive,
    deleted,
    revoked: explicitRevoked ?? (deleted || isActive === false),
  };
}

type MembershipAccessRefreshActions = {
  invalidateOrganizations: () => PromiseLike<unknown> | unknown;
  refreshOrganizations: () => PromiseLike<unknown> | unknown;
  refreshAccess: () => PromiseLike<unknown> | unknown;
  redirectToOrganizationSelection: () => void;
};

export async function reconcileMembershipAccessChange(
  change: MembershipAccessChange,
  actions: MembershipAccessRefreshActions,
) {
  let refreshFailed = false;
  let refreshError: unknown;
  const refreshOrganizationAccess = async (
    action: () => PromiseLike<unknown> | unknown,
  ) => {
    try {
      await action();
    } catch (error) {
      if (!refreshFailed) {
        refreshFailed = true;
        refreshError = error;
      }
    }
  };
  const organizationRefresh = Promise.all([
    refreshOrganizationAccess(actions.invalidateOrganizations),
    refreshOrganizationAccess(actions.refreshOrganizations),
  ]);

  if (change.revoked) {
    // Leave the stale organization immediately. The refreshes keep running so
    // the selector opens with the user's remaining active organizations.
    actions.redirectToOrganizationSelection();
    await organizationRefresh;
    return;
  }

  await organizationRefresh;
  await actions.refreshAccess();
  if (refreshFailed) {
    throw refreshError;
  }
}

function getString(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function getBoolean(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === 'boolean' ? value : null;
}
