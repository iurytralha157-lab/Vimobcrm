import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { type AuditFeedEvent, userActivityAPI } from '@/lib/api/user-activity'

type UseAuditFeedOptions = {
  enabled?: boolean
  organizationId?: string
  onEvent?: (event: AuditFeedEvent) => void
}

export function useAuditFeed(options: UseAuditFeedOptions = {}) {
  const queryClient = useQueryClient()
  const { organization, profile, tenantContext, isSuperAdmin, userOrganizations } = useAuth()
  const onEvent = options.onEvent
  const organizationId = options.organizationId || organization?.id || profile?.organization_id || null
  const memberRole = useMemo(() => {
    if (!organizationId) return undefined

    return (
      userOrganizations.find((org) => org.organization_id === organizationId)?.member_role ||
      (tenantContext?.organizationId === organizationId ? tenantContext.memberRole : undefined)
    )
  }, [organizationId, tenantContext, userOrganizations])
  const canSubscribeAuditFeed = Boolean(
    isSuperAdmin ||
      memberRole === 'owner' ||
      memberRole === 'admin' ||
      memberRole === 'manager' ||
      memberRole === 'super_admin',
  )
  const enabled = (options.enabled ?? true) && canSubscribeAuditFeed

  useEffect(() => {
    if (!organizationId || !enabled) return

    const reconcile = () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
      queryClient.invalidateQueries({ queryKey: ['user-activity'] })
    }

    return userActivityAPI.connectAuditFeed({
      organizationId,
      onSubscribed: reconcile,
      onEvent: (event) => {
        reconcile()
        onEvent?.(event)

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('vimob:audit-log-created', { detail: event }))
        }
      },
      onError: () => undefined,
    })
  }, [enabled, onEvent, organizationId, queryClient])
}
