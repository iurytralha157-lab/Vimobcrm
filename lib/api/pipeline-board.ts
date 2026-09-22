import {
  leadMetaFiltersResponseSchema,
  pipelineBoardResponseSchema,
  pipelineStageCountsResponseSchema,
  pipelineStageLeadsResponseSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'
import {
  resolvePipelineDateModeForRange,
  type PipelineDateMode,
} from '@/lib/pipeline-date-mode'
import {
  buildPipelineBoardQuery,
  type PipelineBoardQueryFilters,
} from '@/lib/pipeline-board-query'
import { PIPELINE_READ_TIMEOUT_MS } from '@/lib/pipeline-reliability'
import { sanitizeLeadMetaFiltersEnvelope } from './pipeline-board-meta-filters'

export type PipelineBoardLead = {
  id: string
  team_id: string | null
  [key: string]: unknown
}

export type PipelineBoardStage = {
  id: string
  is_qualified: boolean
  leads: PipelineBoardLead[]
  total_lead_count: number
  total_value?: number
  has_more: boolean
  [key: string]: unknown
}

export type PipelineBoardFilters = PipelineBoardQueryFilters

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
  sources: string[]
  pages: Array<{ id: string; name: string }>
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
  signal?: AbortSignal
}) {
  const response = await vimobAPIRequest<BoardResponse>('/v1/pipeline-board', {
    organizationId: params.organizationId,
    query: buildPipelineBoardQuery(params),
    signal: params.signal,
    timeoutMs: PIPELINE_READ_TIMEOUT_MS,
    retry: false,
  })
  validateDomainResponse(pipelineBoardResponseSchema, response, 'pipeline-board.list')

  return response.data
}
export async function getPipelineStageLeads(params: {
  organizationId?: string | null
  pipelineId: string
  stageId: string
  offset: number
  cursorBefore?: string
  cursorBeforeId?: string
  filterUserId?: string
  filters?: PipelineBoardFilters
  limit?: number
  signal?: AbortSignal
}) {
  const response = await vimobAPIRequest<StageLeadsResponse>('/v1/pipeline-stage-leads', {
    organizationId: params.organizationId,
    query: buildPipelineBoardQuery(params),
    signal: params.signal,
    timeoutMs: PIPELINE_READ_TIMEOUT_MS,
    retry: false,
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
  signal?: AbortSignal
}) {
  if (!params.pipelineId || params.stageIds.length === 0) return {}

  const response = await vimobAPIRequest<StageCountsResponse>('/v1/pipeline-stage-counts', {
    organizationId: params.organizationId,
    signal: params.signal,
    query: {
      ...buildPipelineBoardQuery(params),
      stageIds: params.stageIds.join(','),
    },
    timeoutMs: PIPELINE_READ_TIMEOUT_MS,
    retry: false,
  })
  validateDomainResponse(pipelineStageCountsResponseSchema, response, 'pipeline-board.stage-counts')

  return response.data
}
export async function getLeadMetaFilters(params: {
  organizationId?: string | null
  dateRange?: { from: Date; to: Date } | null
  dateMode?: PipelineDateMode
  pipelineId?: string | null
  filterPage?: string | null
  signal?: AbortSignal
}) {
  const response = await vimobAPIRequest<LeadMetaFiltersEnvelope>('/v1/lead-meta-filters', {
    organizationId: params.organizationId,
    signal: params.signal,
    query: {
      pipelineId: params.pipelineId,
      filterPage: params.filterPage,
      dateFrom: params.dateRange?.from.toISOString(),
      dateTo: params.dateRange?.to.toISOString(),
      dateMode: resolvePipelineDateModeForRange(params.dateRange, params.dateMode),
    },
    timeoutMs: PIPELINE_READ_TIMEOUT_MS,
    retry: false,
  })
  const validated = validateDomainResponse(
    leadMetaFiltersResponseSchema,
    sanitizeLeadMetaFiltersEnvelope(response),
    'pipeline-board.meta-filters',
  )

  return validated.data
}
