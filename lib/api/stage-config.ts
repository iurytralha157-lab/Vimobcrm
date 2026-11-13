import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import { stageInactivityCreateInputSchema, stageInactivityUpdateInputSchema, stageInactivityMutationResponseSchema, type StageInactivityCreateInput, type StageInactivityUpdateInput, type StageInactivityPolicy } from '@/lib/validation/stage-inactivity'
import { apiPipelineSLAListResponseSchema, apiPipelineSLAResponseSchema, apiStageAutomationListResponseSchema, apiStageAutomationResponseSchema, apiStageOperationalListResponseSchema, apiStageOperationalResponseSchema, entityIdSchema, parseDomainInput, pipelineSLAInputSchema, stageAutomationInputSchema, stageAutomationUpdateInputSchema, stageAutomationStatusInputSchema, stageAutomationDeleteInputSchema, stageOperationalConfigInputSchema, validateDomainResponse } from '@/lib/validation'

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
  inactivity_policy?: StageInactivityPolicy | null
  inactivity_runtime_available?: boolean
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

export type StageAutomationUpdateInput = StageAutomationInput & { expected_updated_at: string }

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
  async createStageInactivityAutomation(input: StageInactivityCreateInput, organizationId: string, intent: VimobAPIRequestIntent) {
    const body = parseDomainInput(stageInactivityCreateInputSchema, input, 'stage-config.inactivity.create')
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>('/v1/stage-inactivity-automations', {
      ...intent, method: 'POST', organizationId, body, retry: false,
    })
    validateDomainResponse(stageInactivityMutationResponseSchema, response, 'stage-config.inactivity.create.policy')
    validateDomainResponse(apiStageAutomationResponseSchema, response, 'stage-config.inactivity.create')
    return response.data
  },

  async updateStageInactivityAutomation(id: string, input: StageInactivityUpdateInput, organizationId: string, intent: VimobAPIRequestIntent) {
    const automationId = parseDomainInput(entityIdSchema, id, 'stage-config.inactivity.update.id')
    const body = parseDomainInput(stageInactivityUpdateInputSchema, input, 'stage-config.inactivity.update')
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>(`/v1/stage-automations/${automationId}/inactivity`, {
      ...intent, method: 'PUT', organizationId, body, retry: false,
    })
    validateDomainResponse(stageInactivityMutationResponseSchema, response, 'stage-config.inactivity.update.policy')
    validateDomainResponse(apiStageAutomationResponseSchema, response, 'stage-config.inactivity.update')
    return response.data
  },

  async listStageAutomations(params: { stageId?: string; organizationId?: string | null } = {}) {
    const stageId = params.stageId ? parseDomainInput(entityIdSchema, params.stageId, 'stage-config.automations.list.stage-id') : undefined
    const response = await vimobAPIRequest<Envelope<StageAutomationRow[]> & { inactivity_runtime_available?: boolean }>('/v1/stage-automations', {
      organizationId: params.organizationId,
      query: { stageId },
    })
    validateDomainResponse(apiStageAutomationListResponseSchema, response, 'stage-config.automations.list')
    return { rows: response.data, inactivityRuntimeAvailable: response.inactivity_runtime_available }
  },

  async createStageAutomation(input: StageAutomationInput, organizationId?: string | null, intent?: VimobAPIRequestIntent) {
    const body = parseDomainInput(stageAutomationInputSchema, input, 'stage-config.automations.create')
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>('/v1/stage-automations', {
      ...intent, method: 'POST', retry: false,
      organizationId,
      body,
    })
    validateDomainResponse(apiStageAutomationResponseSchema, response, 'stage-config.automations.create')
    return response.data
  },

  async updateStageAutomation(id: string, input: StageAutomationUpdateInput, organizationId?: string | null, intent?: VimobAPIRequestIntent) {
    const automationId = parseDomainInput(entityIdSchema, id, 'stage-config.automations.update.id')
    const body = parseDomainInput(stageAutomationUpdateInputSchema, input, 'stage-config.automations.update')
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>(`/v1/stage-automations/${automationId}`, {
      ...intent, method: 'PATCH', retry: false,
      organizationId,
      body,
    })
    validateDomainResponse(apiStageAutomationResponseSchema, response, 'stage-config.automations.update')
    return response.data
  },

  async deleteStageAutomation(id: string, expectedUpdatedAt: string, organizationId?: string | null, intent?: VimobAPIRequestIntent) {
    const automationId = parseDomainInput(entityIdSchema, id, 'stage-config.automations.delete.id')
    const body = parseDomainInput(stageAutomationDeleteInputSchema, { expected_updated_at: expectedUpdatedAt }, 'stage-config.automations.delete')
    await vimobAPIRequest<null>(`/v1/stage-automations/${automationId}`, {
      ...intent, method: 'DELETE', organizationId, body, retry: false,
    })
  },

  async toggleStageAutomation(id: string, isActive: boolean, expectedUpdatedAt: string, organizationId?: string | null, intent?: VimobAPIRequestIntent) {
    const automationId = parseDomainInput(entityIdSchema, id, 'stage-config.automations.toggle.id')
    const body = parseDomainInput(stageAutomationStatusInputSchema, { is_active: isActive, expected_updated_at: expectedUpdatedAt }, 'stage-config.automations.toggle')
    const response = await vimobAPIRequest<Envelope<StageAutomationRow>>(`/v1/stage-automations/${automationId}/status`, {
      ...intent, method: 'PATCH', retry: false,
      organizationId,
      body,
    })
    validateDomainResponse(apiStageAutomationResponseSchema, response, 'stage-config.automations.toggle')
    return response.data
  },

  async listOperationalConfigs(params: {
    pipelineId?: string
    stageId?: string
    organizationId?: string | null
  } = {}) {
    const pipelineId = params.pipelineId ? parseDomainInput(entityIdSchema, params.pipelineId, 'stage-config.operational.list.pipeline-id') : undefined
    const stageId = params.stageId ? parseDomainInput(entityIdSchema, params.stageId, 'stage-config.operational.list.stage-id') : undefined
    const response = await vimobAPIRequest<Envelope<StageOperationalConfigRow[]>>('/v1/stage-operational-configs', {
      organizationId: params.organizationId,
      query: {
        pipelineId,
        stageId,
      },
    })
    validateDomainResponse(apiStageOperationalListResponseSchema, response, 'stage-config.operational.list')
    return response.data
  },

  async upsertOperationalConfig(input: StageOperationalConfigInput, organizationId?: string | null) {
    const body = parseDomainInput(stageOperationalConfigInputSchema, input, 'stage-config.operational.upsert')
    const response = await vimobAPIRequest<Envelope<StageOperationalConfigRow>>('/v1/stage-operational-configs', {
      method: 'PUT',
      organizationId,
      body,
    })
    validateDomainResponse(apiStageOperationalResponseSchema, response, 'stage-config.operational.upsert')
    return response.data
  },

  async listPipelineSLASettings(pipelineId?: string | null, organizationId?: string | null) {
    const id = pipelineId ? parseDomainInput(entityIdSchema, pipelineId, 'stage-config.sla.list.pipeline-id') : undefined
    const response = await vimobAPIRequest<Envelope<PipelineSLASettingsRow[]>>('/v1/pipeline-sla-settings', {
      organizationId,
      query: { pipelineId: id },
    })
    validateDomainResponse(apiPipelineSLAListResponseSchema, response, 'stage-config.sla.list')
    return response.data
  },

  async upsertPipelineSLASettings(input: PipelineSLASettingsInput, organizationId?: string | null) {
    const body = parseDomainInput(pipelineSLAInputSchema, input, 'stage-config.sla.upsert')
    const response = await vimobAPIRequest<Envelope<PipelineSLASettingsRow>>('/v1/pipeline-sla-settings', {
      method: 'PUT',
      organizationId,
      body,
    })
    validateDomainResponse(apiPipelineSLAResponseSchema, response, 'stage-config.sla.upsert')
    return response.data
  },
}
