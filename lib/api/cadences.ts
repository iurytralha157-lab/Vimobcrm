import {
  apiCadenceTaskResponseSchema,
  apiCadenceTemplateListResponseSchema,
  apiSwitchLeadCadenceResponseSchema,
  createCadenceTaskInputSchema,
  parseDomainInput,
  updateCadenceTaskBodySchema,
  switchLeadCadenceInputSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export interface CadenceTaskTemplate {
  id: string
  cadence_template_id: string
  day_offset: number
  title: string
  description: string | null
  position: number | null
  type: string | null
  observation: string | null
  recommended_message: string | null
}

export interface CadenceTemplate {
  id: string
  organization_id: string
  pipeline_id: string | null
  stage_id: string | null
  stage_key: string | null
  name: string
  description?: string | null
  is_active?: boolean
  created_at: string
  updated_at?: string
  tasks: CadenceTaskTemplate[]
}

export type CadenceTaskType = 'call' | 'message' | 'email' | 'note'

export type CreateCadenceTaskInput = {
  cadence_template_id: string
  day_offset: number
  type: CadenceTaskType
  title: string
  description?: string | null
  observation?: string | null
  recommended_message?: string | null
}

export type UpdateCadenceTaskInput = Omit<CreateCadenceTaskInput, 'cadence_template_id'> & {
  id: string
}

export const cadencesAPI = {
  async listTemplates(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<CadenceTemplate[]>>('/v1/cadence-templates', {
      organizationId,
    })
    validateDomainResponse(apiCadenceTemplateListResponseSchema, response, 'cadences.templates.list')
    return response.data
  },

  async createTask(input: CreateCadenceTaskInput, organizationId?: string | null) {
    const body = parseDomainInput(createCadenceTaskInputSchema, input, 'cadences.tasks.create')
    const response = await vimobAPIRequest<Envelope<CadenceTaskTemplate>>('/v1/cadence-tasks', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiCadenceTaskResponseSchema, response, 'cadences.tasks.create')
    return response.data
  },

  async updateTask(input: UpdateCadenceTaskInput, organizationId?: string | null) {
    const { id, ...body } = input
    const validatedBody = parseDomainInput(updateCadenceTaskBodySchema, body, 'cadences.tasks.update')
    const response = await vimobAPIRequest<Envelope<CadenceTaskTemplate>>(`/v1/cadence-tasks/${id}`, {
      method: 'PATCH',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiCadenceTaskResponseSchema, response, 'cadences.tasks.update')
    return response.data
  },

  async deleteTask(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/cadence-tasks/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async switchLeadCadence(leadId: string, cadenceTemplateId: string, organizationId?: string | null) {
    const body = parseDomainInput(switchLeadCadenceInputSchema, {
      cadence_template_id: cadenceTemplateId,
    }, 'cadences.lead.switch')
    const response = await vimobAPIRequest<Envelope<{
      enrollment_id: string
      lead_id: string
      cadence_template_id: string
    }>>(`/v1/leads/${leadId}/cadence`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiSwitchLeadCadenceResponseSchema, response, 'cadences.lead.switch')
    return response.data
  },
}
