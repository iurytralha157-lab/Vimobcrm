import { supabase } from '@/integrations/supabase/client'
import {
  leadMetaFiltersResponseSchema,
  pipelineBoardResponseSchema,
  pipelineStageCountsResponseSchema,
  pipelineStageLeadsResponseSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'
import { VimobAPIError } from './vimob-client'

export type PipelineBoardLead = {
  id: string
  [key: string]: unknown
}

export type PipelineBoardStage = {
  id: string
  leads: PipelineBoardLead[]
  total_lead_count: number
  has_more: boolean
  [key: string]: unknown
}

export type PipelineBoardFilters = {
  dateRange?: { from: Date; to: Date } | null
  filterTag?: string
  filterDealStatus?: string
  searchQuery?: string
  filterCampaign?: string
  filterAdSet?: string
  filterAd?: string
  filterSource?: string
  filterUserIds?: string[]
}

type BoardResponse = {
  data: PipelineBoardStage[]
}

type StageLeadsResponse = {
  stageId: string
  leads: PipelineBoardLead[]
}

type StageCountsResponse = {
  data: Record<string, number>
}

export type LeadMetaFiltersResponse = {
  campaigns: Array<{ id: string; name: string }>
  adsets: Array<{ id: string; name: string; campaignId: string }>
  ads: Array<{ id: string; name: string; adsetId: string; campaignId: string }>
}

type LeadMetaFiltersEnvelope = {
  data: LeadMetaFiltersResponse
}

export async function getPipelineBoard(params: {
  organizationId?: string | null
  pipelineId?: string
  filterUserId?: string
  filters?: PipelineBoardFilters
  limit?: number
}) {
  try {
    const response = await vimobAPIRequest<BoardResponse>('/v1/pipeline-board', {
      organizationId: params.organizationId,
      query: buildPipelineBoardQuery(params),
      timeoutMs: 4_000,
      skipTelemetry: true,
    })
    validateDomainResponse(pipelineBoardResponseSchema, response, 'pipeline-board.list')

    return response.data
  } catch (error) {
    if (!isReadAPIUnavailable(error)) throw error
    return getPipelineBoardFromSupabase(params)
  }
}

export async function getPipelineStageLeads(params: {
  organizationId?: string | null
  pipelineId: string
  stageId: string
  offset: number
  filterUserId?: string
  filters?: PipelineBoardFilters
  limit?: number
}) {
  try {
    const response = await vimobAPIRequest<StageLeadsResponse>('/v1/pipeline-stage-leads', {
      organizationId: params.organizationId,
      query: buildPipelineBoardQuery(params),
      timeoutMs: 4_000,
      skipTelemetry: true,
    })
    validateDomainResponse(pipelineStageLeadsResponseSchema, response, 'pipeline-board.stage-leads')
    return response
  } catch (error) {
    if (!isReadAPIUnavailable(error)) throw error
    const leads = await getStageLeadsFromSupabase(params)
    return { stageId: params.stageId, leads }
  }
}

export async function getPipelineStageCounts(params: {
  organizationId?: string | null
  pipelineId?: string
  stageIds: string[]
  filterUserId?: string
  filters?: PipelineBoardFilters
}) {
  if (!params.pipelineId || params.stageIds.length === 0) return {}

  try {
    const response = await vimobAPIRequest<StageCountsResponse>('/v1/pipeline-stage-counts', {
      organizationId: params.organizationId,
      query: {
        ...buildPipelineBoardQuery(params),
        stageIds: params.stageIds.join(','),
      },
      timeoutMs: 4_000,
      skipTelemetry: true,
    })
    validateDomainResponse(pipelineStageCountsResponseSchema, response, 'pipeline-board.stage-counts')

    return response.data
  } catch (error) {
    if (!isReadAPIUnavailable(error)) throw error
    return getPipelineStageCountsFromSupabase(params)
  }
}

export async function getLeadMetaFilters(params: {
  organizationId?: string | null
  dateRange?: { from: Date; to: Date } | null
}) {
  try {
    const response = await vimobAPIRequest<LeadMetaFiltersEnvelope>('/v1/lead-meta-filters', {
      organizationId: params.organizationId,
      query: {
        dateFrom: params.dateRange?.from.toISOString(),
        dateTo: params.dateRange?.to.toISOString(),
      },
      timeoutMs: 4_000,
      skipTelemetry: true,
    })
    validateDomainResponse(leadMetaFiltersResponseSchema, response, 'pipeline-board.meta-filters')

    return response.data
  } catch (error) {
    if (!isReadAPIUnavailable(error)) throw error
    return { campaigns: [], adsets: [], ads: [] }
  }
}

function isReadAPIUnavailable(error: unknown) {
  return error instanceof VimobAPIError && ['api_timeout', 'api_unavailable'].includes(error.code)
}

async function getPipelineBoardFromSupabase(params: {
  organizationId?: string | null
  pipelineId?: string
  filterUserId?: string
  filters?: PipelineBoardFilters
  limit?: number
}): Promise<PipelineBoardStage[]> {
  if (!params.organizationId || !params.pipelineId) return []

  const { data: stages, error } = await supabase
    .from('stages')
    .select('*')
    .eq('organization_id', params.organizationId)
    .eq('pipeline_id', params.pipelineId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error

  const board = await Promise.all((stages ?? []).map(async (stage) => {
    const leads = await getStageLeadsFromSupabase({
      ...params,
      stageId: stage.id,
      offset: 0,
    })
    const total = await getStageLeadCountFromSupabase({
      ...params,
      stageId: stage.id,
    })

    return {
      ...stage,
      leads,
      total_lead_count: total,
      has_more: total > leads.length,
    }
  }))

  return board as PipelineBoardStage[]
}

async function getStageLeadsFromSupabase(params: {
  organizationId?: string | null
  pipelineId?: string
  stageId: string
  offset?: number
  filterUserId?: string
  filters?: PipelineBoardFilters
  limit?: number
}): Promise<PipelineBoardLead[]> {
  if (!params.organizationId || !params.pipelineId) return []
  if (params.filters?.filterUserIds?.length === 0) return []

  const limit = params.limit ?? 12
  const offset = params.offset ?? 0
  let query = supabase
    .from('leads')
    .select('*')
    .eq('organization_id', params.organizationId)
    .eq('pipeline_id', params.pipelineId)
    .eq('stage_id', params.stageId)
    .order('stage_entered_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  query = applyLeadFilters(query, params.filterUserId, params.filters)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as PipelineBoardLead[]
}

async function getPipelineStageCountsFromSupabase(params: {
  organizationId?: string | null
  pipelineId?: string
  stageIds: string[]
  filterUserId?: string
  filters?: PipelineBoardFilters
}) {
  const entries = await Promise.all(params.stageIds.map(async (stageId) => {
    const count = await getStageLeadCountFromSupabase({ ...params, stageId })
    return [stageId, count] as const
  }))

  return Object.fromEntries(entries)
}

async function getStageLeadCountFromSupabase(params: {
  organizationId?: string | null
  pipelineId?: string
  stageId: string
  filterUserId?: string
  filters?: PipelineBoardFilters
}) {
  if (!params.organizationId || !params.pipelineId) return 0
  if (params.filters?.filterUserIds?.length === 0) return 0

  let query = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', params.organizationId)
    .eq('pipeline_id', params.pipelineId)
    .eq('stage_id', params.stageId)

  query = applyLeadFilters(query, params.filterUserId, params.filters)

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

function applyLeadFilters<TQuery>(
  query: TQuery,
  filterUserId?: string,
  filters?: PipelineBoardFilters,
): TQuery {
  let next = query as TQuery & {
    eq: (column: string, value: string) => typeof next
    in: (column: string, values: string[]) => typeof next
    gte: (column: string, value: string) => typeof next
    lte: (column: string, value: string) => typeof next
    or: (filters: string) => typeof next
  }

  if (filterUserId && filterUserId !== 'all') {
    next = next.eq('assigned_user_id', filterUserId)
  }
  if (filters?.filterUserIds && filters.filterUserIds.length > 0) {
    next = next.in('assigned_user_id', filters.filterUserIds)
  }
  if (filters?.filterDealStatus) {
    next = next.eq('deal_status', filters.filterDealStatus)
  }
  if (filters?.filterSource) {
    next = next.eq('source', filters.filterSource)
  }
  if (filters?.filterCampaign) {
    next = next.eq('meta_campaign_id', filters.filterCampaign)
  }
  if (filters?.filterAdSet) {
    next = next.eq('meta_adset_id', filters.filterAdSet)
  }
  if (filters?.filterAd) {
    next = next.eq('meta_ad_id', filters.filterAd)
  }
  if (filters?.dateRange?.from) {
    next = next.gte('created_at', filters.dateRange.from.toISOString())
  }
  if (filters?.dateRange?.to) {
    next = next.lte('created_at', filters.dateRange.to.toISOString())
  }
  if (filters?.searchQuery?.trim()) {
    const term = sanitizePostgrestSearch(filters.searchQuery.trim())
    next = next.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
  }

  return next as TQuery
}

function sanitizePostgrestSearch(value: string) {
  return value.replace(/[,%]/g, '')
}

function buildPipelineBoardQuery(params: {
  pipelineId?: string
  stageId?: string
  offset?: number
  filterUserId?: string
  filters?: PipelineBoardFilters
  limit?: number
}) {
  const filters = params.filters

  return {
    pipelineId: params.pipelineId,
    stageId: params.stageId,
    offset: params.offset,
    limit: params.limit,
    filterUserId: params.filterUserId,
    dateFrom: filters?.dateRange?.from.toISOString(),
    dateTo: filters?.dateRange?.to.toISOString(),
    filterTag: filters?.filterTag,
    filterDealStatus: filters?.filterDealStatus,
    search: filters?.searchQuery,
    filterCampaign: filters?.filterCampaign,
    filterAdSet: filters?.filterAdSet,
    filterAd: filters?.filterAd,
    filterSource: filters?.filterSource,
    filterUserIds: serializeOptionalIds(filters?.filterUserIds),
  }
}

function serializeOptionalIds(values?: string[]) {
  if (!Array.isArray(values)) return undefined
  if (values.length === 0) return '__none__'

  return values.join(',')
}
