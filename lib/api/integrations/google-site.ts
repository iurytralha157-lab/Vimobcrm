import { siteAPI, type OrganizationSite } from '@/lib/api/site'
import { getSitePublicUrl } from '@/lib/site/site-publication'
import {
  googleAnalyticsMeasurementIdSchema,
  googleSearchConsoleVerificationTokenSchema,
  googleTagManagerContainerIdSchema,
} from '@/lib/validation/integrations'

export type GoogleSiteIntegrationField =
  | 'google_analytics_id'
  | 'gtm_id'
  | 'google_search_console_verification'

export interface GoogleSiteIntegrationStatus {
  configured: boolean
  customDomain: string | null
  domainVerified: boolean
  legacyValue: boolean
  publicUrl: string | null
  siteActive: boolean
  siteExists: boolean
  subdomain: string | null
  value: string | null
}

export interface GoogleSiteIntegrationMutationResult {
  site: OrganizationSite
  status: GoogleSiteIntegrationStatus
}

export async function getGoogleSiteIntegration(
  field: GoogleSiteIntegrationField,
  organizationId?: string | null,
): Promise<GoogleSiteIntegrationStatus> {
  const site = await siteAPI.getSite(organizationId)
  return getGoogleSiteIntegrationStatus(site, field)
}

export async function saveGoogleSiteIntegration(
  field: GoogleSiteIntegrationField,
  value: string | null,
  organizationId?: string | null,
  knownSite?: OrganizationSite | null,
): Promise<GoogleSiteIntegrationMutationResult> {
  const existing = knownSite === undefined
    ? await siteAPI.getSite(organizationId)
    : knownSite
  const payload = { [field]: value } as Partial<OrganizationSite>

  let site = existing
    ? await siteAPI.updateSite(payload, organizationId)
    : await siteAPI.createSite(payload, organizationId)

  // CreateSite is idempotent for the organization. If another request created
  // the site between our read and insert, repeat the narrow update so the
  // requested integration value cannot be silently lost.
  if (readField(site, field) !== value) {
    site = await siteAPI.updateSite(payload, organizationId)
  }

  return {
    site,
    status: getGoogleSiteIntegrationStatus(site, field),
  }
}

export function getGoogleSiteIntegrationStatus(
  site: OrganizationSite | null,
  field: GoogleSiteIntegrationField,
): GoogleSiteIntegrationStatus {
  const value = readField(site, field)
  const legacyValue =
    field === 'google_analytics_id' && /^(?:UA-\d+-\d+)$/i.test(value || '')
  const configured = isValidGoogleSiteIntegrationValue(field, value) && !legacyValue
  const domainVerified = site?.domain_verified === true
  const publicUrl = getSitePublicUrl({
    customDomain: site?.custom_domain,
    domainVerified,
    subdomain: site?.subdomain,
  })

  return {
    configured,
    customDomain: site?.custom_domain || null,
    domainVerified,
    legacyValue,
    publicUrl,
    siteActive: site?.is_active === true,
    siteExists: site !== null,
    subdomain: site?.subdomain || null,
    value,
  }
}

function isValidGoogleSiteIntegrationValue(
  field: GoogleSiteIntegrationField,
  value: string | null,
) {
  if (!value) return false

  switch (field) {
    case 'google_analytics_id':
      return googleAnalyticsMeasurementIdSchema.safeParse(value).success
    case 'gtm_id':
      return googleTagManagerContainerIdSchema.safeParse(value).success
    case 'google_search_console_verification':
      return googleSearchConsoleVerificationTokenSchema.safeParse(value).success
  }
}

function readField(
  site: OrganizationSite | null,
  field: GoogleSiteIntegrationField,
) {
  const value = site?.[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
