import {
  leadMetaFiltersResponseSchema,
  pipelineBoardResponseSchema,
  pipelineStageCountsResponseSchema,
  pipelineStageLeadsResponseSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import type { PipelineDateMode } from '@/lib/pipeline-date-mode'
import {
  buildPipelineBoardQuery,
  buildPipelineLeadMetaFilterQuery,
  type PipelineBoardQueryFilters,
} from '@/lib/pipeline-board-query'
import { PIPELINE_READ_TIMEOUT_MS } from '@/lib/pipeline-reliability'
import { sanitizeLeadMetaFiltersEnvelope } from './pipeline-board-meta-filters'
import { toQueuePool } from '@/lib/queue-pool'
import type { APIQueuePool } from '@/lib/validation/queue-runtime'

export type PipelineBoardLead = {
  queuePool?: APIQueuePool | null
  queue_pool?: import('@/lib/validation/queue-runtime').QueuePool | null
  id: string
  team_id: string | null
  can_operate?: boolean
  updated_at?: string | null
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
  hasMore?: boolean
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
  intent?: VimobAPIRequestIntent
}) {
  const response = await vimobAPIRequest<BoardResponse>('/v1/pipeline-board', {
    organizationId: params.organizationId,
    query: buildPipelineBoardQuery(params),
    ...params.intent,
    signal: params.signal ?? params.intent?.signal,
    timeoutMs: PIPELINE_READ_TIMEOUT_MS,
    retry: false,
  })
  validateDomainResponse(pipelineBoardResponseSchema, response, 'pipeline-board.list')

  return response.data.map((stage) => ({ ...stage, leads: stage.leads.map(normalizeQueuePoolLead) }))
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
  intent?: VimobAPIRequestIntent
}) {
  const response = await vimobAPIRequest<StageLeadsResponse>('/v1/pipeline-stage-leads', {
    organizationId: params.organizationId,
    query: buildPipelineBoardQuery(params),
    ...params.intent,
    signal: params.signal ?? params.intent?.signal,
    timeoutMs: PIPELINE_READ_TIMEOUT_MS,
    retry: false,
  })
  validateDomainResponse(pipelineStageLeadsResponseSchema, response, 'pipeline-board.stage-leads')
  return { ...response, leads: response.leads.map(normalizeQueuePoolLead) }
}

function normalizeQueuePoolLead(lead: PipelineBoardLead): PipelineBoardLead {
  return { ...lead, queue_pool: lead.queuePool !== undefined ? toQueuePool(lead.queuePool) : lead.queue_pool ?? null }
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
  entryMode?: boolean
  scopeToBoard?: boolean
  teamId?: string | null
  userId?: string | null
  dealStatus?: string | null
  tagIds?: string[]
  searchQuery?: string
  signal?: AbortSignal
}) {
  const response = await vimobAPIRequest<LeadMetaFiltersEnvelope>('/v1/lead-meta-filters', {
    organizationId: params.organizationId,
    signal: params.signal,
    query: buildPipelineLeadMetaFilterQuery(params),
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
