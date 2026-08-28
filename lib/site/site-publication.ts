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

export function getSitePublicPageUrl(baseUrl: string | null, pagePath: string) {
  if (!baseUrl) return null

  try {
    const parsedBase = new URL(baseUrl)
    if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') return null

    const normalizedBase = parsedBase.toString().replace(/\/+$/, '')
    const normalizedPath = `/${pagePath.trim().replace(/^\/+/, '')}`
    return `${normalizedBase}${normalizedPath}`
  } catch {
    return null
  }
}
