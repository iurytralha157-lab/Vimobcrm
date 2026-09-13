import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import { useGoogleSiteIntegration } from '@/hooks/integrations/google-site'
import { googleTagManagerIntegrationsAPI } from '@/lib/api/integrations'
import type { OrganizationSite } from '@/lib/api/site'

export function useGoogleTagManagerIntegration(options: { enabled?: boolean } = {}) {
  return useGoogleSiteIntegration('gtm_id', options)
}

export function useSaveGoogleTagManagerIntegration() {
  const queryClient = useQueryClient()
  const { activeOrganization } = useAuth()
  const organizationId = activeOrganization.organizationId

  return useMutation({
    mutationFn: (containerId: string | null) => {
      if (!organizationId) throw new Error('Organização não encontrada.')
      const knownSite = queryClient.getQueryData<OrganizationSite | null>([
        'organization-site',
        organizationId,
      ])
      return googleTagManagerIntegrationsAPI.save(containerId, organizationId, knownSite)
    },
    onSuccess: ({ site }) => {
      queryClient.setQueryData(['organization-site', organizationId], site)
      toast.success('Google Tag Manager atualizado.')
    },
    onError: () => toast.error('Não foi possível atualizar o Google Tag Manager.'),
  })
}
