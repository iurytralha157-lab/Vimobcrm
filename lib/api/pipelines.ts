import type { Tables } from '@/integrations/supabase/types'
import { supabase } from '@/integrations/supabase/client'
import {
  apiPipelineListResponseSchema,
  apiPipelineResponseSchema,
  apiStageListResponseSchema,
  apiStageResponseSchema,
  parseDomainInput,
  pipelineCreateInputSchema,
  pipelineRoundRobinInputSchema,
  pipelineUpdateInputSchema,
  stageCreateInputSchema,
  stageUpdateInputSchema,
  stagesReorderInputSchema,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'
import { VimobAPIError } from './vimob-client'

type PipelineRow = Tables<'pipelines'> & {
  is_active?: boolean | null
  position?: number | null
  updated_at?: string | null
}

type StageRow = Tables<'stages'>

type APIPipeline = {
  id: string
  organizationId: string
  name: string
  isDefault: boolean
  isActive: boolean
  position: number
  defaultRoundRobinId?: string
  createdAt: string
  updatedAt: string
}

type APIStage = {
  id: string
  organizationId: string
  pipelineId: string
  name: string
  color?: string
  stageKey?: string
  position: number
  isWon: boolean
  isLost: boolean
  isActive: boolean
  slaHours?: number
  createdAt: string
  updatedAt: string
}

type APIListResponse<T> = {
  data: T[]
}

type APIItemResponse<T> = {
  data: T
}

type StageOrderItem = {
  id: string
  name: string
  color?: string | null
  stage_key?: string | null
}

export const pipelinesAPI = {
  async getPipelines(organizationId?: string) {
    try {
      const response = await vimobAPIRequest<APIListResponse<APIPipeline>>('/v1/pipelines', {
        organizationId,
        timeoutMs: 4_000,
        skipTelemetry: true,
      })
      validateDomainResponse(apiPipelineListResponseSchema, response, 'pipelines.list')

      return response.data.map(toLegacyPipeline)
    } catch (error) {
      if (!isReadAPIUnavailable(error)) throw error
      return getPipelinesFromSupabase(organizationId)
    }
  },

  async createPipeline(input: { name: string; isDefault?: boolean }, organizationId?: string) {
    const body = parseDomainInput(pipelineCreateInputSchema, input, 'pipelines.create')
    const response = await vimobAPIRequest<APIItemResponse<APIPipeline>>('/v1/pipelines', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiPipelineResponseSchema, response, 'pipelines.create')

    return toLegacyPipeline(response.data)
  },

  async updatePipeline(id: string, input: { name?: string; isDefault?: boolean }, organizationId?: string) {
    const body = parseDomainInput(pipelineUpdateInputSchema, input, 'pipelines.update')
    const response = await vimobAPIRequest<APIItemResponse<APIPipeline>>(`/v1/pipelines/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiPipelineResponseSchema, response, 'pipelines.update')

    return toLegacyPipeline(response.data)
  },

  async deletePipeline(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/pipelines/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getStages(pipelineId?: string, organizationId?: string) {
    try {
      const response = await vimobAPIRequest<APIListResponse<APIStage>>('/v1/stages', {
        organizationId,
        query: { pipelineId },
        timeoutMs: 4_000,
        skipTelemetry: true,
      })
      validateDomainResponse(apiStageListResponseSchema, response, 'stages.list')

      return response.data.map(toLegacyStage)
    } catch (error) {
      if (!isReadAPIUnavailable(error)) throw error
      return getStagesFromSupabase(pipelineId, organizationId)
    }
  },

  async createStage(input: { pipelineId: string; name: string; color?: string }, organizationId?: string) {
    const pipelineId = parseDomainInput(uuidSchema, input.pipelineId, 'stages.create.pipeline-id')
    const body = parseDomainInput(stageCreateInputSchema, { name: input.name, color: input.color }, 'stages.create')
    const response = await vimobAPIRequest<APIItemResponse<APIStage>>(`/v1/pipelines/${pipelineId}/stages`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiStageResponseSchema, response, 'stages.create')

    return toLegacyStage(response.data)
  },

  async updateStage(id: string, input: { name?: string; color?: string; stageKey?: string; isWon?: boolean; isLost?: boolean; isActive?: boolean }, organizationId?: string) {
    const body = parseDomainInput(stageUpdateInputSchema, input, 'stages.update')
    const response = await vimobAPIRequest<APIItemResponse<APIStage>>(`/v1/stages/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiStageResponseSchema, response, 'stages.update')

    return toLegacyStage(response.data)
  },

  async reorderStages(pipelineId: string, stages: StageOrderItem[], organizationId?: string) {
    const body = parseDomainInput(stagesReorderInputSchema, {
      stages: stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        color: stage.color || undefined,
        stageKey: stage.stage_key || undefined,
      })),
    }, 'stages.reorder')
    const response = await vimobAPIRequest<APIListResponse<APIStage>>(`/v1/pipelines/${pipelineId}/stages/reorder`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiStageListResponseSchema, response, 'stages.reorder')

    return response.data.map(toLegacyStage)
  },

  async deleteStage(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/stages/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async setPipelineRoundRobin(pipelineId: string, roundRobinId: string | null, organizationId?: string) {
    const body = parseDomainInput(pipelineRoundRobinInputSchema, { roundRobinId }, 'pipelines.round-robin')
    const response = await vimobAPIRequest<APIItemResponse<APIPipeline>>(`/v1/pipelines/${pipelineId}/round-robin`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiPipelineResponseSchema, response, 'pipelines.round-robin')

    return toLegacyPipeline(response.data)
  },
}

function isReadAPIUnavailable(error: unknown) {
  return error instanceof VimobAPIError && ['api_timeout', 'api_unavailable'].includes(error.code)
}

async function getPipelinesFromSupabase(organizationId?: string): Promise<PipelineRow[]> {
  if (!organizationId) return []

  const { data, error } = await supabase
    .from('pipelines')
    .select('*')
    .eq('organization_id', organizationId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as PipelineRow[]
}

async function getStagesFromSupabase(pipelineId?: string, organizationId?: string): Promise<StageRow[]> {
  if (!organizationId || !pipelineId) return []

  const { data, error } = await supabase
    .from('stages')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('pipeline_id', pipelineId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

function toLegacyPipeline(pipeline: APIPipeline): PipelineRow {
  return {
    created_at: pipeline.createdAt,
    default_round_robin_id: pipeline.defaultRoundRobinId || null,
    first_response_start: null,
    id: pipeline.id,
    include_automation_in_first_response: null,
    is_default: pipeline.isDefault,
    name: pipeline.name,
    organization_id: pipeline.organizationId,
    pool_enabled: null,
    pool_max_redistributions: null,
    pool_timeout_minutes: null,
    is_active: pipeline.isActive,
    position: pipeline.position,
    updated_at: pipeline.updatedAt,
  }
}

function toLegacyStage(stage: APIStage): StageRow {
  return {
    color: stage.color || null,
    created_at: stage.createdAt,
    id: stage.id,
    is_active: stage.isActive,
    is_lost: stage.isLost,
    is_won: stage.isWon,
    name: stage.name,
    organization_id: stage.organizationId,
    pipeline_id: stage.pipelineId,
    position: stage.position,
    sla_hours: stage.slaHours ?? null,
    stage_key: stage.stageKey || null,
    updated_at: stage.updatedAt,
  }
}
