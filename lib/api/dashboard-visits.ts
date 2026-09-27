import {
  dashboardFiltersSchema,
  parseDomainInput,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation'
import {
  dashboardVisitsResponseSchema,
  type DashboardVisits,
} from '@/lib/validation/dashboard-visits'
import type { DashboardAPIFilters } from '@/lib/api/dashboard'
import { vimobAPIRequest } from '@/lib/api/vimob-client'

function normalize(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed && trimmed.toLowerCase() !== 'all' ? trimmed : undefined
}

export async function getDashboardVisits(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
  signal?: AbortSignal
}): Promise<DashboardVisits> {
  const organizationId = parseDomainInput(uuidSchema, params.organizationId, 'dashboard.visits.organization-id')
  const input = params.filters
  const filters = parseDomainInput(dashboardFiltersSchema, {
    dateRange: input?.dateRange,
    granularity: input?.granularity,
    pipelineId: normalize(input?.pipelineId),
    teamId: normalize(input?.teamId),
    userId: normalize(input?.userId),
    source: normalize(input?.source),
    pageId: normalize(input?.pageId),
    campaignId: normalize(input?.campaignId),
    adSetId: normalize(input?.adSetId),
    adId: normalize(input?.adId),
    tagIds: input?.tagIds,
    tagId: normalize(input?.tagId),
    dealStatus: normalize(input?.dealStatus),
    searchQuery: normalize(input?.searchQuery),
  }, 'dashboard.visits.filters')

  const response = await vimobAPIRequest<unknown>('/v1/dashboard/visits', {
    organizationId,
    query: {
      dateFrom: filters.dateRange?.from.toISOString(),
      dateTo: filters.dateRange?.to.toISOString(),
      granularity: filters.granularity,
      pipelineId: filters.pipelineId,
      teamId: filters.teamId,
      userId: filters.userId,
      source: filters.source,
      pageId: filters.pageId,
      campaignId: filters.campaignId,
      adSetId: filters.adSetId,
      adId: filters.adId,
      tagIds: filters.tagIds?.join(','),
      tagId: filters.tagId,
      dealStatus: filters.dealStatus,
      searchQuery: filters.searchQuery,
    },
    signal: params.signal,
  })
  return validateDomainResponse(dashboardVisitsResponseSchema, response, 'dashboard.visits').data
}
