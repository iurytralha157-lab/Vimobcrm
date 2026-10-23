import { useMemo } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out'
import {
  createWhatsAppAccessScope,
  type WhatsAppQueryScope,
} from '@/lib/whatsapp-query-cache'

export function useWhatsAppQueryScope(): WhatsAppQueryScope {
  const { profile, tenantContext, session } = useAuth()
  const activeOrganization = useActiveOrganization()
  const authSessionId = getGlobalSignOutSessionId(session)

  return useMemo(() => {
    const draftAccessScope = createWhatsAppAccessScope({
      memberRole: tenantContext?.memberRole,
      permissions: tenantContext?.permissions,
      isTeamLeader: tenantContext?.isTeamLeader,
      ledTeamIds: tenantContext?.ledTeamIds,
      ledUserIds: tenantContext?.ledUserIds,
      ledPipelineIds: tenantContext?.ledPipelineIds,
      isSuperAdmin: tenantContext?.isSuperAdmin,
    })
    return {
      organizationId: activeOrganization.organizationId,
      userId: profile?.id ?? null,
      draftAccessScope,
      // This is an opaque client lifetime pin, never proof of authorization.
      // Same-SID token refresh stays stable; replacing SID retires old WA data.
      accessScope: JSON.stringify([draftAccessScope, authSessionId]),
    }
  }, [activeOrganization.organizationId, profile?.id, tenantContext, authSessionId])
}
