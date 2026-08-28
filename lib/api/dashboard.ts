import {
  apiDashboardDealsEvolutionSchema,
  apiDashboardDealsEvolutionResponseSchema,
  apiDashboardExtraCountsSchema,
  apiDashboardExtraCountsResponseSchema,
  apiDashboardFunnelSchema,
  apiDashboardFunnelResponseSchema,
  apiDashboardRecentActivitiesSchema,
  apiDashboardRecentActivitiesResponseSchema,
  apiDashboardSourceSchema,
  apiDashboardSourceResponseSchema,
  apiDashboardStatsSchema,
  apiDashboardStatsResponseSchema,
  apiDashboardTeamLeadIdsSchema,
  apiDashboardTopBrokersSchema,
  apiDashboardTopBrokersResponseSchema,
  apiDashboardUpcomingTasksSchema,
  apiDashboardUpcomingTasksResponseSchema,
  dashboardDateRangeSchema,
  dashboardFiltersSchema,
  dashboardLimitSchema,
  dashboardOptionalIdSchema,
  parseDomainInput,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation'
import type { z } from 'zod'
import { vimobAPIRequest } from './vimob-client'

export type DashboardAPIFilters = {
  dateRange?: { from: Date; to: Date } | null
  granularity?: 'hour' | 'day' | 'week' | 'month' | null
  teamId?: string | null
  userId?: string | null
  source?: string | null
  campaignId?: string | null
  adSetId?: string | null
  adId?: string | null
  tagId?: string | null
  dealStatus?: string | null
  searchQuery?: string | null
}

export type DashboardStatsResponse = z.infer<typeof apiDashboardStatsSchema>
export type DashboardFunnelPoint = z.infer<typeof apiDashboardFunnelSchema>[number]
export type DashboardSourcePoint = z.infer<typeof apiDashboardSourceSchema>[number]
export type DashboardTopBrokersResponse = z.infer<typeof apiDashboardTopBrokersSchema>
export type DashboardUpcomingTask = z.infer<typeof apiDashboardUpcomingTasksSchema>[number]
export type DashboardExtraCounts = z.infer<typeof apiDashboardExtraCountsSchema>
export type DashboardRecentActivity = z.infer<typeof apiDashboardRecentActivitiesSchema>[number]
export type DashboardDealsEvolutionPoint = z.infer<typeof apiDashboardDealsEvolutionSchema>[number]

type DashboardRequestContext = {
  organizationId?: string | null
  signal?: AbortSignal
}

export async function getDashboardStats(params: DashboardRequestContext & {
  filters?: DashboardAPIFilters
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.stats')
  const filters = parseDomainInput(dashboardFiltersSchema, normalizeDashboardFilters(params.filters), 'dashboard.stats')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/stats', {
    organizationId,
    query: buildDashboardQuery(filters),
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardStatsResponseSchema, response, 'dashboard.stats')

  return validated.data
}

export async function getDashboardFunnel(params: DashboardRequestContext & {
  filters?: DashboardAPIFilters
  pipelineId?: string | null
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.funnel')
  const filters = parseDomainInput(dashboardFiltersSchema, normalizeDashboardFilters(params.filters), 'dashboard.funnel')
  const pipelineId = parseDomainInput(dashboardOptionalIdSchema, normalizeDashboardFilterValue(params.pipelineId), 'dashboard.funnel.pipeline-id')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/funnel', {
    organizationId,
    query: {
      ...buildDashboardQuery(filters),
      pipelineId,
    },
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardFunnelResponseSchema, response, 'dashboard.funnel')

  return validated.data
}

export async function getDashboardSources(params: DashboardRequestContext & {
  filters?: DashboardAPIFilters
  pipelineId?: string | null
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.sources')
  const filters = parseDomainInput(dashboardFiltersSchema, normalizeDashboardFilters(params.filters), 'dashboard.sources')
  const pipelineId = parseDomainInput(dashboardOptionalIdSchema, normalizeDashboardFilterValue(params.pipelineId), 'dashboard.sources.pipeline-id')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/sources', {
    organizationId,
    query: {
      ...buildDashboardQuery(filters),
      pipelineId,
    },
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardSourceResponseSchema, response, 'dashboard.sources')

  return validated.data
}

export async function getDashboardTopBrokers(params: DashboardRequestContext & {
  filters?: DashboardAPIFilters
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.top-brokers')
  const filters = parseDomainInput(dashboardFiltersSchema, normalizeDashboardFilters(params.filters), 'dashboard.top-brokers')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/top-brokers', {
    organizationId,
    query: buildDashboardQuery(filters),
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardTopBrokersResponseSchema, response, 'dashboard.top-brokers')

  return validated.data
}

export async function getDashboardUpcomingTasks(params: DashboardRequestContext & {
  limit?: number
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.upcoming-tasks')
  const limit = parseDomainInput(dashboardLimitSchema, params.limit, 'dashboard.upcoming-tasks.limit')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/upcoming-tasks', {
    organizationId,
    query: {
      limit,
    },
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardUpcomingTasksResponseSchema, response, 'dashboard.upcoming-tasks')

  return validated.data
}

export async function getDashboardDealsEvolution(params: DashboardRequestContext & {
  filters?: DashboardAPIFilters
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.deals-evolution')
  const filters = parseDomainInput(dashboardFiltersSchema, normalizeDashboardFilters(params.filters), 'dashboard.deals-evolution')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/deals-evolution', {
    organizationId,
    query: buildDashboardQuery(filters),
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardDealsEvolutionResponseSchema, response, 'dashboard.deals-evolution')

  return validated.data
}

export async function getDashboardExtraCounts(params: DashboardRequestContext & {
  filters?: DashboardAPIFilters
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.extra-counts')
  const filters = parseDomainInput(dashboardFiltersSchema, normalizeDashboardFilters(params.filters), 'dashboard.extra-counts')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/extra-counts', {
    organizationId,
    query: buildDashboardQuery(filters),
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardExtraCountsResponseSchema, response, 'dashboard.extra-counts')

  return validated.data
}

export async function getDashboardRecentActivities(params: DashboardRequestContext & {
  limit?: number
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.recent-activities')
  const limit = parseDomainInput(dashboardLimitSchema, params.limit, 'dashboard.recent-activities.limit')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/recent-activities', {
    organizationId,
    query: {
      limit,
    },
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardRecentActivitiesResponseSchema, response, 'dashboard.recent-activities')

  return validated.data
}

export async function getDashboardTeamLeadIds(params: DashboardRequestContext & {
  teamId?: string | null
  dateRange?: { from: Date; to: Date } | null
}) {
  const organizationId = parseDashboardOrganizationId(params.organizationId, 'dashboard.team-lead-ids')
  const teamId = parseDomainInput(uuidSchema, normalizeDashboardFilterValue(params.teamId), 'dashboard.team-lead-ids.team-id')
  const dateRange = parseDomainInput(
    dashboardDateRangeSchema.nullable().optional(),
    params.dateRange,
    'dashboard.team-lead-ids.date-range',
  )
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/team-lead-ids', {
    organizationId,
    query: {
      teamId,
      dateFrom: dateRange?.from.toISOString(),
      dateTo: dateRange?.to.toISOString(),
    },
    signal: params.signal,
  })
  const validated = validateDomainResponse(apiDashboardTeamLeadIdsSchema, response, 'dashboard.team-lead-ids')

  return validated.leadIds
}

function normalizeDashboardFilters(filters?: DashboardAPIFilters): DashboardAPIFilters {
  return {
    ...filters,
    teamId: normalizeDashboardFilterValue(filters?.teamId),
    userId: normalizeDashboardFilterValue(filters?.userId),
    source: normalizeDashboardFilterValue(filters?.source),
    campaignId: normalizeDashboardFilterValue(filters?.campaignId),
    adSetId: normalizeDashboardFilterValue(filters?.adSetId),
    adId: normalizeDashboardFilterValue(filters?.adId),
    tagId: normalizeDashboardFilterValue(filters?.tagId),
    dealStatus: normalizeDashboardFilterValue(filters?.dealStatus),
    searchQuery: normalizeDashboardSearch(filters?.searchQuery),
  }
}

export function getDashboardFiltersQueryKey(filters?: DashboardAPIFilters) {
  const normalized = normalizeDashboardFilters(filters)
  return {
    dateFrom: dashboardDateQueryKey(normalized.dateRange?.from),
    dateTo: dashboardDateQueryKey(normalized.dateRange?.to),
    granularity: normalized.granularity ?? null,
    teamId: normalized.teamId ?? null,
    userId: normalized.userId ?? null,
    source: normalized.source ?? null,
    campaignId: normalized.campaignId ?? null,
    adSetId: normalized.adSetId ?? null,
    adId: normalized.adId ?? null,
    tagId: normalized.tagId ?? null,
    dealStatus: normalized.dealStatus ?? null,
    searchQuery: normalized.searchQuery ?? null,
  }
}

export function getDashboardOptionalIdQueryKey(value?: string | null) {
  return normalizeDashboardFilterValue(value)
}

function normalizeDashboardFilterValue(value?: string | null) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.toLowerCase() !== 'all' ? trimmed : null
}

function normalizeDashboardSearch(value?: string | null) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function dashboardDateQueryKey(value?: Date) {
  if (!value) return null
  if (!(value instanceof Date)) return 'invalid-date'
  const timestamp = value.getTime()
  return Number.isFinite(timestamp) ? value.toISOString() : 'invalid-date'
}

function parseDashboardOrganizationId(value: string | null | undefined, context: string) {
  return parseDomainInput(uuidSchema, value, `${context}.organization-id`)
}

function buildDashboardQuery(filters?: DashboardAPIFilters) {
  return {
    dateFrom: filters?.dateRange?.from.toISOString(),
    dateTo: filters?.dateRange?.to.toISOString(),
    granularity: filters?.granularity,
    teamId: filters?.teamId,
    userId: filters?.userId,
    source: filters?.source,
    campaignId: filters?.campaignId,
    adSetId: filters?.adSetId,
    adId: filters?.adId,
    tagId: filters?.tagId,
    dealStatus: filters?.dealStatus,
    searchQuery: filters?.searchQuery,
  }
}
