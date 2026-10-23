'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import { adminAPI } from '@/lib/api/admin'
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out'
import type { WhatsAppNotificationResetInput, WhatsAppNotificationResetScope } from '@/lib/validation/notifications'

const PREVIEW_QUERY_KEY = 'admin-whatsapp-notification-reset-preview'

export function useWhatsAppNotificationReset(scope: 'organization' | 'all') {
  const { activeOrganization, isSuperAdmin, user, session } = useAuth()
  const queryClient = useQueryClient()
  const organizationId = activeOrganization.organizationId
  const userId = user?.id
  const sessionId = getGlobalSignOutSessionId(session)
  const ready = Boolean(isSuperAdmin && organizationId && userId && sessionId)
  const identity = useMemo(() => ({ organizationId, userId, sessionId, scope, ready }),
    [organizationId, userId, sessionId, scope, ready])
  const active = useRef<{ identity: typeof identity; controller: AbortController } | null>(null)

  useLayoutEffect(() => {
    const visit = { identity, controller: new AbortController() }
    active.current = visit
    return () => {
      visit.controller.abort()
      if (active.current === visit) active.current = null
    }
  }, [identity])

  const requireVisit = () => {
    const visit = active.current
    if (!ready || !organizationId || !visit || visit.identity !== identity || visit.controller.signal.aborted) {
      throw new Error('Seu acesso mudou. Consulte a fila novamente antes de continuar.')
    }
    return { visit, organizationId, expectedUserId: userId, expectedSessionId: sessionId }
  }

  const previewQuery = useQuery({
    queryKey: [PREVIEW_QUERY_KEY, organizationId, userId, sessionId, scope],
    enabled: false,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => {
      const context = requireVisit()
      const input: WhatsAppNotificationResetScope = scope === 'all'
        ? { scope: 'all' }
        : { scope: 'organization', organizationId: context.organizationId }
      return adminAPI.previewWhatsAppNotificationReset(input, context.organizationId, {
        signal,
        expectedUserId: context.expectedUserId,
        expectedSessionId: context.expectedSessionId,
      })
    },
  })

  const resetMutation = useMutation({
    mutationFn: (input: WhatsAppNotificationResetInput) => {
      const context = requireVisit()
      if (input.scope !== scope || (input.scope === 'organization' && input.organizationId !== context.organizationId)) {
        throw new Error('O escopo mudou. Consulte a fila novamente antes de continuar.')
      }
      return adminAPI.resetWhatsAppNotifications(input, context.organizationId, {
        signal: context.visit.controller.signal,
        expectedUserId: context.expectedUserId,
        expectedSessionId: context.expectedSessionId,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-notification-delivery-operations'] }),
        queryClient.invalidateQueries({ queryKey: [PREVIEW_QUERY_KEY] }),
      ])
    },
  })

  return {
    ready,
    previewQuery,
    resetMutation,
    isCurrentVisit: () => active.current?.identity === identity && !active.current.controller.signal.aborted,
  }
}
