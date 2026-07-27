import { getPublicAppUrl } from '@/config/constants'

type PublicSiteAddress = {
  customDomain?: string | null
  domainVerified?: boolean | null
  subdomain?: string | null
}

export function getSitePublicUrl({
  customDomain,
  domainVerified,
  subdomain,
}: PublicSiteAddress) {
  const cleanCustomDomain = customDomain?.trim()
  if (cleanCustomDomain && domainVerified) {
    return `https://${cleanCustomDomain}`
  }

  const cleanSubdomain = subdomain?.trim()
  return cleanSubdomain ? getPublicAppUrl(`/sites/${cleanSubdomain}`) : null
}
