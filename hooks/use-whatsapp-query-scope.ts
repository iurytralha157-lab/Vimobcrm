import { useMemo } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import {
  createWhatsAppAccessScope,
  type WhatsAppQueryScope,
} from '@/lib/whatsapp-query-cache'

export function useWhatsAppQueryScope(): WhatsAppQueryScope {
  const { profile, organization, tenantContext } = useAuth()

  return useMemo(() => ({
    organizationId: organization?.id ?? profile?.organization_id ?? null,
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
  }), [organization?.id, profile?.id, profile?.organization_id, tenantContext])
}
