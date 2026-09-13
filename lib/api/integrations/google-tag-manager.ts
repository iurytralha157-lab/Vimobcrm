import { parseDomainInput } from '@/lib/validation'
import { googleTagManagerIntegrationInputSchema } from '@/lib/validation'
import type { OrganizationSite } from '@/lib/api/site'
import {
  getGoogleSiteIntegration,
  saveGoogleSiteIntegration,
  type GoogleSiteIntegrationStatus,
} from './google-site'

export const googleTagManagerIntegrationsAPI = {
  get(organizationId?: string | null) {
    return getGoogleSiteIntegration('gtm_id', organizationId)
  },

  save(
    containerId: string | null,
    organizationId?: string | null,
    knownSite?: OrganizationSite | null,
  ) {
    const input = parseDomainInput(
      googleTagManagerIntegrationInputSchema,
      { containerId },
      'integrations.google-tag-manager.save',
    )
    return saveGoogleSiteIntegration(
      'gtm_id',
      input.containerId,
      organizationId,
      knownSite,
    )
  },
}

export type GoogleTagManagerIntegrationStatus = GoogleSiteIntegrationStatus
