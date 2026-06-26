import { vimobAPIRequest } from './vimob-client'

export type DashboardAPIFilters = {
  dateRange?: { from: Date; to: Date } | null
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
  const response = await vimobAPIRequest<Envelope<DashboardStatsResponse>>('/v1/dashboard/stats', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(params.filters),
  })

  return response.data
}

export async function getDashboardFunnel(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
  pipelineId?: string | null
}) {
  const response = await vimobAPIRequest<Envelope<DashboardFunnelPoint[]>>('/v1/dashboard/funnel', {
    organizationId: params.organizationId,
    query: {
      ...buildDashboardQuery(params.filters),
      pipelineId: params.pipelineId,
    },
  })

  return response.data
}

export async function getDashboardSources(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
  pipelineId?: string | null
}) {
  const response = await vimobAPIRequest<Envelope<DashboardSourcePoint[]>>('/v1/dashboard/sources', {
    organizationId: params.organizationId,
    query: {
      ...buildDashboardQuery(params.filters),
      pipelineId: params.pipelineId,
    },
  })

  return response.data
}

export async function getDashboardTopBrokers(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
}) {
  const response = await vimobAPIRequest<Envelope<DashboardTopBrokersResponse>>('/v1/dashboard/top-brokers', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(params.filters),
  })

  return response.data
}

export async function getDashboardUpcomingTasks(params: {
  organizationId?: string | null
  limit?: number
}) {
  const response = await vimobAPIRequest<Envelope<DashboardUpcomingTask[]>>('/v1/dashboard/upcoming-tasks', {
    organizationId: params.organizationId,
    query: {
      limit: params.limit,
    },
  })

  return response.data
}

export async function getDashboardDealsEvolution(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
}) {
  const response = await vimobAPIRequest<Envelope<DashboardDealsEvolutionPoint[]>>('/v1/dashboard/deals-evolution', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(params.filters),
  })

  return response.data
}

export async function getDashboardExtraCounts(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
}) {
  const response = await vimobAPIRequest<Envelope<DashboardExtraCounts>>('/v1/dashboard/extra-counts', {
    organizationId: params.organizationId,
    query: buildDashboardQuery(params.filters),
  })

  return response.data
}

export async function getDashboardRecentActivities(params: {
  organizationId?: string | null
  limit?: number
}) {
  const response = await vimobAPIRequest<Envelope<DashboardRecentActivity[]>>('/v1/dashboard/recent-activities', {
    organizationId: params.organizationId,
    query: {
      limit: params.limit,
    },
  })

  return response.data
}

export async function getDashboardTeamLeadIds(params: {
  organizationId?: string | null
  teamId?: string | null
  dateRange?: { from: Date; to: Date } | null
}) {
  const response = await vimobAPIRequest<{ leadIds: string[] }>('/v1/dashboard/team-lead-ids', {
    organizationId: params.organizationId,
    query: {
      teamId: params.teamId,
      dateFrom: params.dateRange?.from.toISOString(),
      dateTo: params.dateRange?.to.toISOString(),
    },
  })

  return response.leadIds
}

function buildDashboardQuery(filters?: DashboardAPIFilters) {
  return {
    dateFrom: filters?.dateRange?.from.toISOString(),
    dateTo: filters?.dateRange?.to.toISOString(),
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
