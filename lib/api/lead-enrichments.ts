import { vimobAPIRequest } from './vimob-client'
import { apiLeadEnrichmentListResponseSchema, parseDomainInput, uuidListSchema, validateDomainResponse } from '@/lib/validation'

export type LeadEnrichmentTag = {
  id: string
  name: string | null
  color: string | null
}

export type LeadEnrichmentTaskCount = {
  pending: number
  completed: number
}

export type LeadEnrichmentUser = {
  id: string
  name: string | null
  avatar_url: string | null
}

export type LeadEnrichmentProperty = {
  id: string
  code: string | null
  title: string | null
  preco: number | null
}

export type LeadEnrichmentMeta = {
  lead_id: string
  campaign_name: string | null
  campaign_id: string | null
  adset_name: string | null
  adset_id: string | null
  ad_name: string | null
  ad_id: string | null
  platform: string | null
}

export type LeadEnrichment = {
  lead_id: string
  tags: LeadEnrichmentTag[]
  tasks_count: LeadEnrichmentTaskCount
  assignee: LeadEnrichmentUser | null
  interest_property: LeadEnrichmentProperty | null
  lead_meta: LeadEnrichmentMeta[]
}

type ListResponse<T> = {
  data: T[]
}

export async function getLeadEnrichments(leadIds: string[], organizationId?: string | null) {
  const uniqueIds = Array.from(new Set(leadIds.filter(Boolean)))
  if (uniqueIds.length === 0) return []
  const ids = parseDomainInput(uuidListSchema, uniqueIds, 'lead-enrichments.list.ids')

  const response = await vimobAPIRequest<ListResponse<LeadEnrichment>>('/v1/lead-enrichments', {
    organizationId,
    query: {
      ids: ids.join(','),
    },
  })
  validateDomainResponse(apiLeadEnrichmentListResponseSchema, response, 'lead-enrichments.list')

  return response.data
}
