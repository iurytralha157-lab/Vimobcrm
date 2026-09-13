import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import { useGoogleSiteIntegration } from '@/hooks/integrations/google-site'
import { googleSearchConsoleIntegrationsAPI } from '@/lib/api/integrations'
import type { OrganizationSite } from '@/lib/api/site'

export function useGoogleSearchConsoleIntegration(options: { enabled?: boolean } = {}) {
  return useGoogleSiteIntegration('google_search_console_verification', options)
}

export function useSaveGoogleSearchConsoleIntegration() {
  const queryClient = useQueryClient()
  const { activeOrganization } = useAuth()
  const organizationId = activeOrganization.organizationId

  return useMutation({
    mutationFn: (verificationToken: string | null) => {
      if (!organizationId) throw new Error('Organização não encontrada.')
      const knownSite = queryClient.getQueryData<OrganizationSite | null>([
        'organization-site',
        organizationId,
      ])
      return googleSearchConsoleIntegrationsAPI.save(
        verificationToken,
        organizationId,
        knownSite,
      )
    },
    onSuccess: ({ site }) => {
      queryClient.setQueryData(['organization-site', organizationId], site)
      toast.success('Google Search Console atualizado.')
    },
    onError: () => toast.error('Não foi possível atualizar o Google Search Console.'),
  })
}
