'use client'

import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { canViewOrganizationPresence } from '@/lib/access/tenant-navigation'
import { userPresenceAPI } from '@/lib/api'

const PRESENCE_POLL_INTERVAL_MS = 30_000
const PRESENCE_STALE_TIME_MS = 15_000
const PRESENCE_GC_TIME_MS = 5 * 60_000

export type UseOrganizationPresenceListOptions = {
  enabled: boolean
}

export function useOrganizationPresenceList({
  enabled,
}: UseOrganizationPresenceListOptions) {
  const { activeOrganization, organization, profile, tenantContext } = useAuth()
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions()
  const organizationId = organization?.is_active === false
    ? undefined
    : activeOrganization.organizationId ?? undefined
  const canViewPresence = canViewOrganizationPresence(
    organizationId,
    tenantContext,
    !permissionsLoading && hasPermission('users_presence_view'),
  )
  const queryEnabled = enabled && Boolean(organizationId) && canViewPresence

  const query = useQuery({
    queryKey: ['organization-presence', organizationId],
    queryFn: ({ signal }) => {
      if (!organizationId) {
        throw new Error('Organização ativa não encontrada.')
      }

      return userPresenceAPI.list(organizationId, { signal })
    },
    enabled: queryEnabled,
    staleTime: PRESENCE_STALE_TIME_MS,
    gcTime: PRESENCE_GC_TIME_MS,
    refetchInterval: queryEnabled ? PRESENCE_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: queryEnabled,
  })

  return {
    ...query,
    organizationId,
    canViewPresence,
    permissionsLoading,
  }
}
