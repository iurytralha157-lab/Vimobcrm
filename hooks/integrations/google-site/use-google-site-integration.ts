import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import {
  getGoogleSiteIntegrationStatus,
  type GoogleSiteIntegrationField,
} from '@/lib/api/integrations/google-site'
import { siteAPI } from '@/lib/api/site'

export function useGoogleSiteIntegration(
  field: GoogleSiteIntegrationField,
  options: { enabled?: boolean } = {},
) {
  const { activeOrganization } = useAuth()
  const organizationId = activeOrganization.organizationId

  return useQuery({
    queryKey: ['organization-site', organizationId],
    queryFn: () => siteAPI.getSite(organizationId),
    select: (site) => getGoogleSiteIntegrationStatus(site, field),
    enabled: options.enabled !== false && Boolean(organizationId),
  })
}
