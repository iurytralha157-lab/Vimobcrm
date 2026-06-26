import { vimobPublicAPIRequest } from './vimob-client'

type PublicSiteQuery = Record<string, string | number | boolean | null | undefined>

export const publicSiteAPI = {
  resolve(domain: string) {
    return vimobPublicAPIRequest<{ found: boolean; site_config?: unknown }>('/v1/public/site/resolve', {
      query: { domain },
    })
  },

  getData<T>(query: PublicSiteQuery) {
    return vimobPublicAPIRequest<T>('/v1/public/site/data', { query })
  },

  submitContact<T>(body: unknown) {
    return vimobPublicAPIRequest<T>('/v1/public/site/contact', {
      method: 'POST',
      body,
    })
  },

  listMenuItems<T>(organizationId: string) {
    return vimobPublicAPIRequest<{ data: T }>('/v1/public/site/menu-items', {
      query: { organization_id: organizationId },
    })
  },

  listSearchFilters<T>(organizationId: string) {
    return vimobPublicAPIRequest<{ data: T }>('/v1/public/site/search-filters', {
      query: { organization_id: organizationId },
    })
  },

  track(body: unknown) {
    return vimobPublicAPIRequest<{ ok: boolean }>('/v1/public/tracking/events', {
      method: 'POST',
      body,
    })
  },
}
