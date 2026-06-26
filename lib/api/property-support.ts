import { vimobAPIRequest } from './vimob-client'

export type PropertyCaptor = {
  id: string
  name: string | null
  email: string | null
  whatsapp: string | null
  avatar_url: string | null
}

export type PropertySiteInfo = {
  subdomain: string | null
  custom_domain: string | null
  domain_verified: boolean | null
}

export type PropertySummary = {
  id: string
  code: string | null
  title: string | null
  preco: number | null
}

type ItemResponse<T> = {
  data: T | null
}

type ListResponse<T> = {
  data: T[]
}

export async function getPropertyCaptor(userId: string, organizationId?: string | null) {
  const response = await vimobAPIRequest<ItemResponse<PropertyCaptor>>(`/v1/property-captors/${userId}`, {
    organizationId,
  })

  return response.data
}

export async function getPropertySiteInfo(organizationId?: string | null) {
  const response = await vimobAPIRequest<ItemResponse<PropertySiteInfo>>('/v1/property-site-info', {
    organizationId,
  })

  return response.data
}

export async function getPropertySummaries(ids: string[], organizationId?: string | null) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  if (uniqueIds.length === 0) return []

  const response = await vimobAPIRequest<ListResponse<PropertySummary>>('/v1/property-summaries', {
    organizationId,
    query: {
      ids: uniqueIds.join(','),
    },
  })

  return response.data
}
