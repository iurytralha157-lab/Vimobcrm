import { googleAnalyticsIntegrationInputSchema } from '@/lib/validation'
import { parseDomainInput } from '@/lib/validation'
import type { OrganizationSite } from '@/lib/api/site'
import {
  getGoogleSiteIntegration,
  saveGoogleSiteIntegration,
  type GoogleSiteIntegrationStatus,
} from './google-site'

export const googleAnalyticsIntegrationsAPI = {
  get(organizationId?: string | null) {
    return getGoogleSiteIntegration('google_analytics_id', organizationId)
  },

  save(
    measurementId: string | null,
    organizationId?: string | null,
    knownSite?: OrganizationSite | null,
  ) {
    const input = parseDomainInput(
      googleAnalyticsIntegrationInputSchema,
      { measurementId },
      'integrations.google-analytics.save',
    )
    return saveGoogleSiteIntegration(
      'google_analytics_id',
      input.measurementId,
      organizationId,
      knownSite,
    )
  },
}

export type GoogleAnalyticsIntegrationStatus = GoogleSiteIntegrationStatus
