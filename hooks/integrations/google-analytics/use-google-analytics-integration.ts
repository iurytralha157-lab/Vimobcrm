import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import { useGoogleSiteIntegration } from '@/hooks/integrations/google-site'
import { googleAnalyticsIntegrationsAPI } from '@/lib/api/integrations'
import type { OrganizationSite } from '@/lib/api/site'

export function useGoogleAnalyticsIntegration(options: { enabled?: boolean } = {}) {
  return useGoogleSiteIntegration('google_analytics_id', options)
}

export function useSaveGoogleAnalyticsIntegration() {
  const queryClient = useQueryClient()
  const { activeOrganization } = useAuth()
  const organizationId = activeOrganization.organizationId

  return useMutation({
    mutationFn: (measurementId: string | null) => {
      if (!organizationId) throw new Error('Organização não encontrada.')
      const knownSite = queryClient.getQueryData<OrganizationSite | null>([
        'organization-site',
        organizationId,
      ])
      return googleAnalyticsIntegrationsAPI.save(measurementId, organizationId, knownSite)
    },
    onSuccess: ({ site }) => {
      queryClient.setQueryData(['organization-site', organizationId], site)
      toast.success('Google Analytics atualizado.')
    },
    onError: () => toast.error('Não foi possível atualizar o Google Analytics.'),
  })
}
