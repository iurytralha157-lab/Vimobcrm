import type { PropertySiteInfo } from '@/lib/api/property-support'

function cleanDomain(value?: string | null) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

function cleanSlug(value?: string | null) {
  const slug = String(value || '').trim()
  return slug ? encodeURIComponent(slug) : ''
}

export function buildPropertySiteUrl(code?: string | null, siteInfo?: PropertySiteInfo | null) {
  const propertyCode = cleanSlug(code)
  if (!propertyCode) return null

  const customDomain = cleanDomain(siteInfo?.custom_domain)
  if (customDomain && siteInfo?.domain_verified) {
    return `https://${customDomain}/imovel/${propertyCode}`
  }

  const subdomain = cleanSlug(siteInfo?.subdomain)
  if (subdomain) {
    return `https://vimob.vettercompany.com.br/sites/${subdomain}/imovel/${propertyCode}`
  }

  return null
}
