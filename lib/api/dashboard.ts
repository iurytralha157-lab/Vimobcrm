import {
  apiDashboardDealsEvolutionResponseSchema,
  apiDashboardExtraCountsResponseSchema,
  apiDashboardFunnelResponseSchema,
  apiDashboardRecentActivitiesResponseSchema,
  apiDashboardSourceResponseSchema,
  apiDashboardStatsResponseSchema,
  apiDashboardTeamLeadIdsSchema,
  apiDashboardTopBrokersResponseSchema,
  apiDashboardUpcomingTasksResponseSchema,
  dashboardFiltersSchema,
  dashboardLimitSchema,
  dashboardOptionalIdSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'
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

export type DashboardStatsResponse = {
  totalLeads: number
  leadsInProgress: number
  leadsClosed: number
  leadsLost: number
  openLeads: number
  lostLeads: number
  conversionRate: number
  closedLeads: number
  wonAverageConversionDays: number | null
  wonConversionBuckets: Array<{
    key: string
    label: string
    count: number
    percentage: number
    value: number
    color: string
  }>
  wonDeals: Array<{
    id: string
    name: string
    phone: string | null
    source: string | null
    value: number
    createdAt: string | null
    wonAt: string | null
    conversionDays: number | null
    assignedUserName: string
  }>
  lostReasonBuckets: Array<{
    key: string
    label: string
    count: number
    percentage: number
    color: string
  }>
  lostDeals: Array<{
    id: string
    name: string
    phone: string | null
    source: string | null
    lostReason: string
    lostReasonGroup: string
    createdAt: string | null
    lostAt: string | null
    assignedUserName: string
  }>
  avgResponseTime: string
  totalSalesValue: number
  pendingCommissions: number
  leadsTrend: number
  openTrend: number
  lostTrend: number
  conversionTrend: number
  closedTrend: number
  totalReceivables: number
  totalPayables: number
  overdueReceivables: number
  overduePayables: number
  paidCommissions: number
}

export type DashboardFunnelPoint = {
  name: string
  value: number
  percentage: number
  stage_key: string
}

export type DashboardSourcePoint = {
  name: string
  value: number
  rawSource: string
}

export type DashboardTopBrokersResponse = {
  brokers: Array<{
    id: string
    name: string
    avatar_url: string | null
    closedLeads: number
    salesValue: number
    totalCommissions: number
  }>
  isFallbackMode: boolean
}

export type DashboardUpcomingTask = {
  id: string
  title: string
  type: 'call' | 'email' | 'meeting' | 'message' | 'task'
  due_date: string
  lead_name: string
  lead_id: string
}

export type DashboardExtraCounts = {
  propertyCount: number
  siteVisits: number
  scheduledVisits: number
}

export type DashboardRecentActivity = {
  id: string
  type: string
  content: string | null
  created_at: string
  lead_name: string
  user_name?: string | null
}

export type DashboardDealsEvolutionPoint = {
  date: string
  ganhos: number
  perdas: number
  abertos: number
}

type Envelope<T> = {
  data: T
}

export async function getDashboardStats(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
}) {
  const filters = parseDomainInput(dashboardFiltersSchema, params.filters ?? {}, 'dashboard.stats')
  const response = await vimobAPIRequest<Envelope<DashboardStatsResponse>>('/v1/dashboard/stats', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(filters),
  })
  validateDomainResponse(apiDashboardStatsResponseSchema, response, 'dashboard.stats')

  return response.data
}

export async function getDashboardFunnel(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
  pipelineId?: string | null
}) {
  const filters = parseDomainInput(dashboardFiltersSchema, params.filters ?? {}, 'dashboard.funnel')
  const pipelineId = parseDomainInput(dashboardOptionalIdSchema, params.pipelineId, 'dashboard.funnel.pipeline-id')
  const response = await vimobAPIRequest<Envelope<DashboardFunnelPoint[]>>('/v1/dashboard/funnel', {
    organizationId: params.organizationId,
    query: {
      ...buildDashboardQuery(filters),
      pipelineId,
    },
  })
  validateDomainResponse(apiDashboardFunnelResponseSchema, response, 'dashboard.funnel')

  return response.data
}

export async function getDashboardSources(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
  pipelineId?: string | null
}) {
  const filters = parseDomainInput(dashboardFiltersSchema, params.filters ?? {}, 'dashboard.sources')
  const pipelineId = parseDomainInput(dashboardOptionalIdSchema, params.pipelineId, 'dashboard.sources.pipeline-id')
  const response = await vimobAPIRequest<Envelope<DashboardSourcePoint[]>>('/v1/dashboard/sources', {
    organizationId: params.organizationId,
    query: {
      ...buildDashboardQuery(filters),
      pipelineId,
    },
  })
  validateDomainResponse(apiDashboardSourceResponseSchema, response, 'dashboard.sources')

  return response.data
}

export async function getDashboardTopBrokers(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
}) {
  const filters = parseDomainInput(dashboardFiltersSchema, params.filters ?? {}, 'dashboard.top-brokers')
  const response = await vimobAPIRequest<Envelope<DashboardTopBrokersResponse>>('/v1/dashboard/top-brokers', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(filters),
  })
  validateDomainResponse(apiDashboardTopBrokersResponseSchema, response, 'dashboard.top-brokers')

  return response.data
}

export async function getDashboardUpcomingTasks(params: {
  organizationId?: string | null
  limit?: number
}) {
  const limit = parseDomainInput(dashboardLimitSchema, params.limit, 'dashboard.upcoming-tasks.limit')
  const response = await vimobAPIRequest<Envelope<DashboardUpcomingTask[]>>('/v1/dashboard/upcoming-tasks', {
    organizationId: params.organizationId,
    query: {
      limit,
    },
  })
  validateDomainResponse(apiDashboardUpcomingTasksResponseSchema, response, 'dashboard.upcoming-tasks')

  return response.data
}

export async function getDashboardDealsEvolution(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
}) {
  const filters = parseDomainInput(dashboardFiltersSchema, params.filters ?? {}, 'dashboard.deals-evolution')
  const response = await vimobAPIRequest<Envelope<DashboardDealsEvolutionPoint[]>>('/v1/dashboard/deals-evolution', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(filters),
  })
  validateDomainResponse(apiDashboardDealsEvolutionResponseSchema, response, 'dashboard.deals-evolution')

  return response.data
}

export async function getDashboardExtraCounts(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
}) {
  const filters = parseDomainInput(dashboardFiltersSchema, params.filters ?? {}, 'dashboard.extra-counts')
  const response = await vimobAPIRequest<Envelope<DashboardExtraCounts>>('/v1/dashboard/extra-counts', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(filters),
  })
  validateDomainResponse(apiDashboardExtraCountsResponseSchema, response, 'dashboard.extra-counts')

  return response.data
}

export async function getDashboardRecentActivities(params: {
  organizationId?: string | null
  limit?: number
}) {
  const limit = parseDomainInput(dashboardLimitSchema, params.limit, 'dashboard.recent-activities.limit')
  const response = await vimobAPIRequest<Envelope<DashboardRecentActivity[]>>('/v1/dashboard/recent-activities', {
    organizationId: params.organizationId,
    query: {
      limit,
    },
  })
  validateDomainResponse(apiDashboardRecentActivitiesResponseSchema, response, 'dashboard.recent-activities')

  return response.data
}

export async function getDashboardTeamLeadIds(params: {
  organizationId?: string | null
  teamId?: string | null
  dateRange?: { from: Date; to: Date } | null
}) {
  const teamId = parseDomainInput(dashboardOptionalIdSchema, params.teamId, 'dashboard.team-lead-ids.team-id')
  const response = await vimobAPIRequest<{ leadIds: string[] }>('/v1/dashboard/team-lead-ids', {
    organizationId: params.organizationId,
    query: {
      teamId,
      dateFrom: params.dateRange?.from.toISOString(),
      dateTo: params.dateRange?.to.toISOString(),
    },
  })
  validateDomainResponse(apiDashboardTeamLeadIdsSchema, response, 'dashboard.team-lead-ids')

  return response.leadIds
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
