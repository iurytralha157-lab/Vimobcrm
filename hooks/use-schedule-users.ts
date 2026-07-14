import { useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useUserAccessScope } from '@/hooks/use-user-access-scope'
import { useUsers } from '@/hooks/use-users'
import type { User } from '@/lib/api/users'

const ALL_PERMISSIONS = '*'

function normalizeRole(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function hasPermission(permissions: readonly string[] | null | undefined, permission: string) {
  return Boolean(permissions?.some((candidate) => candidate === ALL_PERMISSIONS || candidate === permission))
}

export function useScheduleUsers(options?: { enabled?: boolean }) {
  const usersQuery = useUsers(options)
  const { profile, organization, tenantContext, isSuperAdmin, userOrganizations } = useAuth()
  const accessScope = useUserAccessScope()

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
    memberRole === 'admin' ||
    memberRole === 'manager' ||
    hasPermission(tenantContext?.permissions, 'schedule_manage')

  const scheduleUsers = useMemo(() => {
    const users = usersQuery.data ?? []
    if (canViewAllScheduleUsers) return users
    const source = tenantLedUserIds && tenantLedUserIds.length > 0 ? tenantLedUserIds : accessScope.ledUserIds
    const allowedUserIds = new Set(source.filter(Boolean))
    if (profileId) allowedUserIds.add(profileId)
    return users.filter((user: User) => allowedUserIds.has(user.id))
  }, [accessScope.ledUserIds, canViewAllScheduleUsers, profileId, tenantLedUserIds, usersQuery.data])

  return {
    ...usersQuery,
    data: scheduleUsers,
    allUsers: usersQuery.data ?? [],
    canViewAllScheduleUsers,
    canFilterScheduleUsers: canViewAllScheduleUsers || scheduleUsers.length > 1 || accessScope.isTeamLeader,
  }
}
