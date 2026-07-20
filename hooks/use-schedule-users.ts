import { useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useUsers } from '@/hooks/use-users'
import type { User } from '@/lib/api/users'

function normalizeRole(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

export function useScheduleUsers(options?: { enabled?: boolean }) {
  const usersQuery = useUsers(options)
  const { profile, organization, tenantContext, isSuperAdmin, userOrganizations } = useAuth()

  const profileId = profile?.id
  const tenantLedUserIds = tenantContext?.ledUserIds
  const activeOrganizationId = organization?.id ?? profile?.organization_id
  const activeMemberRole =
    tenantContext?.memberRole ??
    userOrganizations.find((item) => item.organization_id === activeOrganizationId)?.member_role ??
    profile?.role
  const memberRole = normalizeRole(activeMemberRole)
  const canViewAllScheduleUsers =
    isSuperAdmin ||
    memberRole === 'owner' ||
    memberRole === 'admin'

  const scheduleUsers = useMemo(() => {
    const users = usersQuery.data ?? []
    if (canViewAllScheduleUsers) return users
    const allowedUserIds = new Set((tenantLedUserIds ?? []).filter(Boolean))
    if (profileId) allowedUserIds.add(profileId)
    return users.filter((user: User) => allowedUserIds.has(user.id))
  }, [canViewAllScheduleUsers, profileId, tenantLedUserIds, usersQuery.data])

  return {
    ...usersQuery,
    data: scheduleUsers,
    allUsers: usersQuery.data ?? [],
    canViewAllScheduleUsers,
    canFilterScheduleUsers:
      canViewAllScheduleUsers ||
      scheduleUsers.length > 1 ||
      Boolean(tenantContext?.isTeamLeader),
  }
}
