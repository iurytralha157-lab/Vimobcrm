import { parseDomainInput } from '@/lib/validation'
import { googleSearchConsoleIntegrationInputSchema } from '@/lib/validation'
import type { OrganizationSite } from '@/lib/api/site'
import {
  getGoogleSiteIntegration,
  saveGoogleSiteIntegration,
  type GoogleSiteIntegrationStatus,
} from './google-site'

export const googleSearchConsoleIntegrationsAPI = {
  get(organizationId?: string | null) {
    return getGoogleSiteIntegration(
      'google_search_console_verification',
      organizationId,
    )
  },

  save(
    verificationToken: string | null,
    organizationId?: string | null,
    knownSite?: OrganizationSite | null,
  ) {
    const input = parseDomainInput(
      googleSearchConsoleIntegrationInputSchema,
      { verificationToken },
      'integrations.google-search-console.save',
    )
    return saveGoogleSiteIntegration(
      'google_search_console_verification',
      input.verificationToken,
      organizationId,
      knownSite,
    )
  },
}

export type GoogleSearchConsoleIntegrationStatus = GoogleSiteIntegrationStatus
