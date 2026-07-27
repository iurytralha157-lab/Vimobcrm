import { vimobAPIRequest } from './vimob-client'
import {
  apiOptionalOrganizationSiteResponseSchema,
  apiDomainVerificationResponseSchema,
  apiOrganizationSiteResponseSchema,
  apiSiteAssetResponseSchema,
  apiSiteMenuItemListResponseSchema,
  apiSiteMenuItemResponseSchema,
  apiSiteSearchFilterListResponseSchema,
  apiSiteSearchFilterResponseSchema,
  entityIdSchema,
  okResponseSchema,
  organizationSiteMutationSchema,
  parseDomainInput,
  siteAssetInputSchema,
  siteMenuItemInputSchema,
  siteMenuItemUpdateSchema,
  siteReorderInputSchema,
  siteSearchFilterInputSchema,
  siteSearchFilterUpdateSchema,
  validateDomainResponse,
} from '@/lib/validation'

type Envelope<T> = {
  data: T
}

export interface OrganizationSite {
  id: string
  organization_id: string
  is_active: boolean
  maintenance_mode: boolean
  maintenance_message: string | null
  subdomain: string | null
  custom_domain: string | null
  domain_verified: boolean
  domain_verified_at: string | null
  domain_verification_token: string
  site_title: string | null
  site_description: string | null
  logo_url: string | null
  favicon_url: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_color: string | null
  whatsapp: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  instagram: string | null
  facebook: string | null
  youtube: string | null
  linkedin: string | null
  about_title: string | null
  about_text: string | null
  about_image_url: string | null
  seo_title: string | null
  seo_description: string | null
  seo_keywords: string | null
  google_analytics_id: string | null
  hero_image_url: string | null
  hero_title: string | null
  hero_subtitle: string | null
  page_banner_url: string | null
  logo_width: number | null
  logo_height: number | null
  watermark_enabled: boolean | null
  watermark_opacity: number | null
  watermark_logo_url: string | null
  watermark_size: number | null
  watermark_position: string | null
  site_theme: string
  background_color: string
  text_color: string
  card_color: string
  show_about_on_home: boolean | null
  about_subtitle?: string | null
  about_stats?: unknown
  about_checkmarks?: unknown
  about_features?: unknown
  gtm_id?: string | null
  meta_pixel_id?: string | null
  google_ads_id?: string | null
  head_scripts?: string | null
  body_scripts?: string | null
  created_at: string
  updated_at: string
}

export interface SiteMenuItem {
  id: string
  organization_id: string
  label: string
  link_type: 'page' | 'filter' | 'external'
  href: string
  position: number
  open_in_new_tab: boolean
  is_active: boolean
  created_at: string | null
}

export interface SiteSearchFilter {
  id: string
  organization_id: string
  filter_key: string
  label: string
  position: number
  is_active: boolean
  created_at: string | null
}

export type SiteAssetType = 'logo' | 'favicon' | 'about' | 'hero' | 'banner' | 'watermark'

export const siteAPI = {
  async getSite(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<OrganizationSite | null>>('/v1/site', {
      organizationId,
    })
    validateDomainResponse(apiOptionalOrganizationSiteResponseSchema, response, 'site.get')
    return response.data
  },

  async createSite(input: Partial<OrganizationSite>, organizationId?: string | null) {
    const body = parseDomainInput(organizationSiteMutationSchema, input, 'site.create')
    const response = await vimobAPIRequest<Envelope<OrganizationSite>>('/v1/site', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiOrganizationSiteResponseSchema, response, 'site.create')
    return response.data
  },

  async updateSite(input: Partial<OrganizationSite>, organizationId?: string | null) {
    const body = parseDomainInput(organizationSiteMutationSchema, input, 'site.update')
    const response = await vimobAPIRequest<Envelope<OrganizationSite>>('/v1/site', {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiOrganizationSiteResponseSchema, response, 'site.update')
    return response.data
  },

  async verifyDomain(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<{
      domain: string
      verified: boolean
      checked_at: string
      reason?: 'challenge_unavailable' | 'challenge_mismatch'
    }>>('/v1/site/domain/verify', {
      method: 'POST',
      organizationId,
    })
    validateDomainResponse(apiDomainVerificationResponseSchema, response, 'site.domain.verify')
    return response.data
  },

  async uploadAsset(input: { file: File; type: SiteAssetType }, organizationId?: string | null) {
    const upload = parseDomainInput(siteAssetInputSchema, input, 'site.assets.upload')
    const formData = new FormData()
    formData.append('file', upload.file)
    formData.append('type', upload.type)

    const response = await vimobAPIRequest<Envelope<{ url: string }>>('/v1/site/assets', {
      method: 'POST',
      organizationId,
      body: formData,
    })
    validateDomainResponse(apiSiteAssetResponseSchema, response, 'site.assets.upload')
    return response.data.url
  },

  async listMenuItems(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SiteMenuItem[]>>('/v1/site/menu-items', {
      organizationId,
    })
    validateDomainResponse(apiSiteMenuItemListResponseSchema, response, 'site.menu.list')
    return response.data
  },

  async createMenuItem(input: Omit<SiteMenuItem, 'id' | 'organization_id' | 'created_at'>, organizationId?: string | null) {
    const body = parseDomainInput(siteMenuItemInputSchema, input, 'site.menu.create')
    const response = await vimobAPIRequest<Envelope<SiteMenuItem>>('/v1/site/menu-items', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiSiteMenuItemResponseSchema, response, 'site.menu.create')
    return response.data
  },

  async updateMenuItem(input: Partial<SiteMenuItem> & { id: string }, organizationId?: string | null) {
    const validated = parseDomainInput(siteMenuItemUpdateSchema, input, 'site.menu.update')
    const { id, ...body } = validated
    const response = await vimobAPIRequest<Envelope<SiteMenuItem>>(`/v1/site/menu-items/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiSiteMenuItemResponseSchema, response, 'site.menu.update')
    return response.data
  },

  async deleteMenuItem(id: string, organizationId?: string | null) {
    const itemId = parseDomainInput(entityIdSchema, id, 'site.menu.delete.id')
    await vimobAPIRequest<null>(`/v1/site/menu-items/${itemId}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async reorderMenuItems(items: { id: string; position: number }[], organizationId?: string | null) {
    const body = parseDomainInput(siteReorderInputSchema, { items }, 'site.menu.reorder')
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/site/menu-items/reorder', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(okResponseSchema, response, 'site.menu.reorder')
  },

  async listSearchFilters(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SiteSearchFilter[]>>('/v1/site/search-filters', {
      organizationId,
    })
    validateDomainResponse(apiSiteSearchFilterListResponseSchema, response, 'site.filters.list')
    return response.data
  },

  async createSearchFilter(input: Pick<SiteSearchFilter, 'filter_key' | 'label' | 'position' | 'is_active'>, organizationId?: string | null) {
    const body = parseDomainInput(siteSearchFilterInputSchema, input, 'site.filters.create')
    const response = await vimobAPIRequest<Envelope<SiteSearchFilter>>('/v1/site/search-filters', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiSiteSearchFilterResponseSchema, response, 'site.filters.create')
    return response.data
  },

  async updateSearchFilter(input: Partial<SiteSearchFilter> & { id: string }, organizationId?: string | null) {
    const validated = parseDomainInput(siteSearchFilterUpdateSchema, input, 'site.filters.update')
    const { id, ...body } = validated
    const response = await vimobAPIRequest<Envelope<SiteSearchFilter>>(`/v1/site/search-filters/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiSiteSearchFilterResponseSchema, response, 'site.filters.update')
    return response.data
  },

  async deleteSearchFilter(id: string, organizationId?: string | null) {
    const filterId = parseDomainInput(entityIdSchema, id, 'site.filters.delete.id')
    await vimobAPIRequest<null>(`/v1/site/search-filters/${filterId}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async reorderSearchFilters(items: { id: string; position: number }[], organizationId?: string | null) {
    const body = parseDomainInput(siteReorderInputSchema, { items }, 'site.filters.reorder')
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/site/search-filters/reorder', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(okResponseSchema, response, 'site.filters.reorder')
  },
}
