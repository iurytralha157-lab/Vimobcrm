import { vimobAPIRequest } from './vimob-client'
import { apiPropertyCaptorResponseSchema, apiPropertySiteInfoResponseSchema, apiPropertySummaryListResponseSchema, entityIdSchema, parseDomainInput, uuidListSchema, validateDomainResponse } from '@/lib/validation'

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
  const id = parseDomainInput(entityIdSchema, userId, 'property-support.captor.id')
  const response = await vimobAPIRequest<ItemResponse<PropertyCaptor>>(`/v1/property-captors/${id}`, {
    organizationId,
  })
  validateDomainResponse(apiPropertyCaptorResponseSchema, response, 'property-support.captor')

  return response.data
}

export async function getPropertySiteInfo(organizationId?: string | null) {
  const response = await vimobAPIRequest<ItemResponse<PropertySiteInfo>>('/v1/property-site-info', {
    organizationId,
  })
  validateDomainResponse(apiPropertySiteInfoResponseSchema, response, 'property-support.site-info')

  return response.data
}

export async function getPropertySummaries(ids: string[], organizationId?: string | null) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  if (uniqueIds.length === 0) return []
  const propertyIds = parseDomainInput(uuidListSchema, uniqueIds, 'property-support.summaries.ids')

  const response = await vimobAPIRequest<ListResponse<PropertySummary>>('/v1/property-summaries', {
    organizationId,
    query: {
      ids: propertyIds.join(','),
    },
  })
  validateDomainResponse(apiPropertySummaryListResponseSchema, response, 'property-support.summaries')

  return response.data
}
