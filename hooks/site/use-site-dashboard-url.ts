'use client'

import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { siteAPI } from '@/lib/api/site'
import { getSitePublicUrl } from '@/lib/site/site-publication'

export function useSiteDashboardUrl() {
  const { loading: authLoading, organization, profile } = useAuth()
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions()
  const organizationId = organization?.id || profile?.organization_id || null
  const canReadSiteSettings = hasPermission('settings_site')

  const query = useQuery({
    queryKey: ['org-site-info', organizationId],
    queryFn: () => siteAPI.getSite(organizationId),
    enabled: Boolean(
      organizationId &&
      !authLoading &&
      !permissionsLoading &&
      canReadSiteSettings
    ),
    staleTime: 5 * 60_000,
    retry: false,
  })

  return getSitePublicUrl({
    customDomain: query.data?.custom_domain,
    domainVerified: query.data?.domain_verified,
    subdomain: query.data?.subdomain,
  })
}
