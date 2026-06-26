import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export interface OrganizationSite {
  id: string
  organization_id: string
  is_active: boolean
  subdomain: string | null
  custom_domain: string | null
  domain_verified: boolean
  domain_verified_at: string | null
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
    return response.data
  },

  async createSite(input: Partial<OrganizationSite>, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<OrganizationSite>>('/v1/site', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async updateSite(input: Partial<OrganizationSite>, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<OrganizationSite>>('/v1/site', {
      method: 'PATCH',
      organizationId,
      body: input,
    })
    return response.data
  },

  async uploadAsset(input: { file: File; type: SiteAssetType }, organizationId?: string | null) {
    const formData = new FormData()
    formData.append('file', input.file)
    formData.append('type', input.type)

    const response = await vimobAPIRequest<Envelope<{ url: string }>>('/v1/site/assets', {
      method: 'POST',
      organizationId,
      body: formData,
    })
    return response.data.url
  },

  async listMenuItems(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SiteMenuItem[]>>('/v1/site/menu-items', {
      organizationId,
    })
    return response.data
  },

  async createMenuItem(input: Omit<SiteMenuItem, 'id' | 'organization_id' | 'created_at'>, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SiteMenuItem>>('/v1/site/menu-items', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async updateMenuItem(input: Partial<SiteMenuItem> & { id: string }, organizationId?: string | null) {
    const { id, ...body } = input
    const response = await vimobAPIRequest<Envelope<SiteMenuItem>>(`/v1/site/menu-items/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    return response.data
  },

  async deleteMenuItem(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/site/menu-items/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async reorderMenuItems(items: { id: string; position: number }[], organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>('/v1/site/menu-items/reorder', {
      method: 'POST',
      organizationId,
      body: { items },
    })
  },

  async listSearchFilters(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SiteSearchFilter[]>>('/v1/site/search-filters', {
      organizationId,
    })
    return response.data
  },

  async createSearchFilter(input: Pick<SiteSearchFilter, 'filter_key' | 'label' | 'position' | 'is_active'>, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SiteSearchFilter>>('/v1/site/search-filters', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async updateSearchFilter(input: Partial<SiteSearchFilter> & { id: string }, organizationId?: string | null) {
    const { id, ...body } = input
    const response = await vimobAPIRequest<Envelope<SiteSearchFilter>>(`/v1/site/search-filters/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    return response.data
  },

  async deleteSearchFilter(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/site/search-filters/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async reorderSearchFilters(items: { id: string; position: number }[], organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>('/v1/site/search-filters/reorder', {
      method: 'POST',
      organizationId,
      body: { items },
    })
  },
}
