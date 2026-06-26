import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined }

export interface StageAutomationRow {
  id: string
  organization_id: string
  stage_id: string | null
  trigger_type: string
  config: JsonValue | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
}

export type StageAutomationInput = {
  stage_id?: string
  automation_type?: string
  trigger_days?: number | null
  target_stage_id?: string | null
  whatsapp_template?: string | null
  alert_message?: string | null
  target_user_id?: string | null
  deal_status?: 'open' | 'won' | 'lost' | null
  action_config?: Record<string, unknown> | null
  is_active?: boolean
}

export interface StageOperationalConfigRow {
  id?: string
  organization_id: string
  stage_id: string
  operation_context: string
  responsible_sector: string | null
  sla_hours: number
  automatic_tasks: JsonValue | null
  automatic_notifications: JsonValue | null
  automatic_operational_requests: JsonValue | null
  checklist_template: JsonValue | null
  approval_flow: JsonValue | null
  dashboard_destination: string | null
  visibility_rules: JsonValue | null
  stage: {
    id?: string
    name: string
    pipeline_id?: string | null
  } | null
}

export type StageOperationalConfigInput = Partial<Omit<StageOperationalConfigRow, 'organization_id' | 'stage'>> & {
  stage_id: string
}

export interface PipelineSLASettingsRow {
  id: string
  organization_id: string
  pipeline_id: string
  stage_id: string | null
  warning_hours: number | null
  critical_hours: number | null
  sla_start_field: string | null
  created_at: string | null
  updated_at: string | null
}

export interface PipelineSLASettingsInput {
  pipeline_id: string
  stage_id?: string | null
  warning_hours?: number
  critical_hours?: number
  sla_start_field?: string
}

export const stageConfigAPI = {
  async listStageAutomations(params: { stageId?: string; organizationId?: string | null } = {}) {
    const response = await vimobAPIRequest<Envelope<StageAutomationRow[]>>('/v1/stage-automations', {
      organizationId: params.organizationId,
      query: { stageId: params.stageId },
    })
    return response.data
  },

  async createStageAutomation(input: StageAutomationInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>('/v1/stage-automations', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async updateStageAutomation(id: string, input: StageAutomationInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>(`/v1/stage-automations/${id}`, {
      method: 'PATCH',
      organizationId,
      body: input,
    })
    return response.data
  },

  async deleteStageAutomation(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/stage-automations/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async toggleStageAutomation(id: string, isActive: boolean, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>(`/v1/stage-automations/${id}/status`, {
      method: 'PATCH',
      organizationId,
      body: { is_active: isActive },
    })
    return response.data
  },

  async listOperationalConfigs(params: {
    pipelineId?: string
    stageId?: string
    organizationId?: string | null
  } = {}) {
    const response = await vimobAPIRequest<Envelope<StageOperationalConfigRow[]>>('/v1/stage-operational-configs', {
      organizationId: params.organizationId,
      query: {
        pipelineId: params.pipelineId,
        stageId: params.stageId,
      },
    })
    return response.data
  },

  async upsertOperationalConfig(input: StageOperationalConfigInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<StageOperationalConfigRow>>('/v1/stage-operational-configs', {
      method: 'PUT',
      organizationId,
      body: input,
    })
    return response.data
  },

  async listPipelineSLASettings(pipelineId?: string | null, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<PipelineSLASettingsRow[]>>('/v1/pipeline-sla-settings', {
      organizationId,
      query: { pipelineId },
    })
    return response.data
  },

  async upsertPipelineSLASettings(input: PipelineSLASettingsInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<PipelineSLASettingsRow>>('/v1/pipeline-sla-settings', {
      method: 'PUT',
      organizationId,
      body: input,
    })
    return response.data
  },
}
