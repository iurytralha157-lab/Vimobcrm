import { useMemo } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import {
  createWhatsAppAccessScope,
  type WhatsAppQueryScope,
} from '@/lib/whatsapp-query-cache'

export function useWhatsAppQueryScope(): WhatsAppQueryScope {
  const { profile, tenantContext } = useAuth()
  const activeOrganization = useActiveOrganization()

  return useMemo(() => ({
    organizationId: activeOrganization.organizationId,
    userId: profile?.id ?? null,
    accessScope: createWhatsAppAccessScope({
      memberRole: tenantContext?.memberRole,
      permissions: tenantContext?.permissions,
      isTeamLeader: tenantContext?.isTeamLeader,
      ledTeamIds: tenantContext?.ledTeamIds,
      ledUserIds: tenantContext?.ledUserIds,
      ledPipelineIds: tenantContext?.ledPipelineIds,
      isSuperAdmin: tenantContext?.isSuperAdmin,
    }),
  }), [activeOrganization.organizationId, profile?.id, tenantContext])
}
