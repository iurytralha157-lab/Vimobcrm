'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { settingsAPI } from '@/lib/api/settings'

export function useUserPermissionsAdmin(userId: string) {
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  return useQuery({
    queryKey: ['user-permissions-admin', organizationId, userId],
    queryFn: () => settingsAPI.getUserPermissions(userId, organizationId),
    enabled: !!organizationId && !!userId,
  })
}

export function useReplaceUserPermissions(userId: string) {
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (permissions: Record<string, boolean>) =>
      settingsAPI.replaceUserPermissions(userId, permissions, organizationId),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions-admin', organizationId, userId], data)
      queryClient.invalidateQueries({ queryKey: ['tenant-context'] })
    },
  })
}

export function useResetUserPermissions(userId: string) {
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => settingsAPI.resetUserPermissions(userId, organizationId),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions-admin', organizationId, userId], data)
      queryClient.invalidateQueries({ queryKey: ['tenant-context'] })
    },
  })
}
