import {
  leadMetaFiltersResponseSchema,
  pipelineBoardResponseSchema,
  pipelineStageCountsResponseSchema,
  pipelineStageLeadsResponseSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

export type PipelineBoardLead = {
  id: string
  [key: string]: unknown
}

export type PipelineBoardStage = {
  id: string
  leads: PipelineBoardLead[]
  total_lead_count: number
  total_value?: number
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
  const response = await vimobAPIRequest<BoardResponse>('/v1/pipeline-board', {
    organizationId: params.organizationId,
    query: buildPipelineBoardQuery(params),
    timeoutMs: 4_000,
    skipTelemetry: true,
  })
  validateDomainResponse(pipelineBoardResponseSchema, response, 'pipeline-board.list')

  return response.data
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
  const response = await vimobAPIRequest<StageLeadsResponse>('/v1/pipeline-stage-leads', {
    organizationId: params.organizationId,
    query: buildPipelineBoardQuery(params),
    timeoutMs: 4_000,
    skipTelemetry: true,
  })
  validateDomainResponse(pipelineStageLeadsResponseSchema, response, 'pipeline-board.stage-leads')
  return response
}

export async function getPipelineStageCounts(params: {
  organizationId?: string | null
  pipelineId?: string
  stageIds: string[]
  filterUserId?: string
  filters?: PipelineBoardFilters
}) {
  if (!params.pipelineId || params.stageIds.length === 0) return {}

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
}

export async function getLeadMetaFilters(params: {
  organizationId?: string | null
  dateRange?: { from: Date; to: Date } | null
  pipelineId?: string | null
}) {
  const response = await vimobAPIRequest<LeadMetaFiltersEnvelope>('/v1/lead-meta-filters', {
    organizationId: params.organizationId,
    query: {
      pipelineId: params.pipelineId,
      dateFrom: params.dateRange?.from.toISOString(),
      dateTo: params.dateRange?.to.toISOString(),
    },
    timeoutMs: 8_000,
    skipTelemetry: true,
  })
  validateDomainResponse(leadMetaFiltersResponseSchema, response, 'pipeline-board.meta-filters')

  return response.data
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
