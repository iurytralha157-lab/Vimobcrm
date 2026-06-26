import type { Tables } from '@/integrations/supabase/types'
import { vimobAPIRequest } from './vimob-client'

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
    const response = await vimobAPIRequest<APIListResponse<APIPipeline>>('/v1/pipelines', {
      organizationId,
    })

    return response.data.map(toLegacyPipeline)
  },

  async createPipeline(input: { name: string; isDefault?: boolean }, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIPipeline>>('/v1/pipelines', {
      method: 'POST',
      organizationId,
      body: {
        name: input.name,
        isDefault: input.isDefault,
      },
    })

    return toLegacyPipeline(response.data)
  },

  async updatePipeline(id: string, input: { name?: string; isDefault?: boolean }, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIPipeline>>(`/v1/pipelines/${id}`, {
      method: 'PATCH',
      organizationId,
      body: {
        name: input.name,
        isDefault: input.isDefault,
      },
    })

    return toLegacyPipeline(response.data)
  },

  async deletePipeline(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/pipelines/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getStages(pipelineId?: string, organizationId?: string) {
    const response = await vimobAPIRequest<APIListResponse<APIStage>>('/v1/stages', {
      organizationId,
      query: { pipelineId },
    })

    return response.data.map(toLegacyStage)
  },

  async createStage(input: { pipelineId: string; name: string; color?: string }, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIStage>>(`/v1/pipelines/${input.pipelineId}/stages`, {
      method: 'POST',
      organizationId,
      body: {
        name: input.name,
        color: input.color,
      },
    })

    return toLegacyStage(response.data)
  },

  async updateStage(id: string, input: { name?: string; color?: string; stageKey?: string; isWon?: boolean; isLost?: boolean; isActive?: boolean }, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIStage>>(`/v1/stages/${id}`, {
      method: 'PATCH',
      organizationId,
      body: input,
    })

    return toLegacyStage(response.data)
  },

  async reorderStages(pipelineId: string, stages: StageOrderItem[], organizationId?: string) {
    const response = await vimobAPIRequest<APIListResponse<APIStage>>(`/v1/pipelines/${pipelineId}/stages/reorder`, {
      method: 'POST',
      organizationId,
      body: {
        stages: stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          color: stage.color || undefined,
          stageKey: stage.stage_key || undefined,
        })),
      },
    })

    return response.data.map(toLegacyStage)
  },

  async deleteStage(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/stages/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async setPipelineRoundRobin(pipelineId: string, roundRobinId: string | null, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIPipeline>>(`/v1/pipelines/${pipelineId}/round-robin`, {
      method: 'POST',
      organizationId,
      body: {
        roundRobinId,
      },
    })

    return toLegacyPipeline(response.data)
  },
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
