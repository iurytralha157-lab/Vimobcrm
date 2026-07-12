import { vimobPublicAPIRequest } from './vimob-client'
import { apiPublicSiteResolveResponseSchema, apiUnknownEnvelopeSchema, okResponseSchema, organizationIdSchema, parseDomainInput, publicContactInputSchema, publicDomainSchema, publicSiteQuerySchema, publicTrackingInputSchema, validateDomainResponse } from '@/lib/validation'

type PublicSiteQuery = Record<string, string | number | boolean | null | undefined>

export const publicSiteAPI = {
  resolve(domain: string) {
    const value = parseDomainInput(publicDomainSchema, domain, 'public-site.resolve.domain')
    return vimobPublicAPIRequest<{ found: boolean; site_config?: unknown }>('/v1/public/site/resolve', {
      query: { domain: value },
    }).then((response) => {
      validateDomainResponse(apiPublicSiteResolveResponseSchema, response, 'public-site.resolve')
      return response
    })
  },

  getData<T>(query: PublicSiteQuery) {
    const input = parseDomainInput(publicSiteQuerySchema, query, 'public-site.data')
    return vimobPublicAPIRequest<T>('/v1/public/site/data', { query: input })
  },

  submitContact<T>(body: unknown) {
    const input = parseDomainInput(publicContactInputSchema, body, 'public-site.contact')
    return vimobPublicAPIRequest<T>('/v1/public/site/contact', {
      method: 'POST',
      body: input,
    })
  },

  listMenuItems<T>(organizationId: string) {
    const id = parseDomainInput(organizationIdSchema, organizationId, 'public-site.menu.organization')
    return vimobPublicAPIRequest<{ data: T }>('/v1/public/site/menu-items', {
      query: { organization_id: id },
    }).then((response) => {
      validateDomainResponse(apiUnknownEnvelopeSchema, response, 'public-site.menu')
      return response
    })
  },

  listSearchFilters<T>(organizationId: string) {
    const id = parseDomainInput(organizationIdSchema, organizationId, 'public-site.filters.organization')
    return vimobPublicAPIRequest<{ data: T }>('/v1/public/site/search-filters', {
      query: { organization_id: id },
    }).then((response) => {
      validateDomainResponse(apiUnknownEnvelopeSchema, response, 'public-site.filters')
      return response
    })
  },

  track(body: unknown) {
    const input = parseDomainInput(publicTrackingInputSchema, body, 'public-site.track')
    return vimobPublicAPIRequest<{ ok: boolean }>('/v1/public/tracking/events', {
      method: 'POST',
      body: input,
    }).then((response) => {
      validateDomainResponse(okResponseSchema, response, 'public-site.track')
      return response
    })
  },
}
