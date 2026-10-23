import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import { captureCurrentLeadRequestIntent } from '@/lib/api/lead-request-intent'
import type { LeadTask } from '@/hooks/use-lead-tasks'
import { apiLeadTaskListResponseSchema, apiLeadTaskResponseSchema, cadenceTaskCompletionInputSchema, entityIdSchema, leadTaskCreateInputSchema, leadTaskPatchInputSchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

type Envelope<T> = {
  data: T
}

export type CompleteCadenceTaskInput = {
  leadId: string
  taskId?: string
  templateTaskId?: string
  dayOffset?: number
  type?: 'call' | 'message' | 'email' | 'note'
  title?: string
  description?: string
  outcome?: string
  outcomeNotes?: string
  organizationId?: string | null
}

export const leadTasksAPI = {
  async list(leadId: string) {
    const id = parseDomainInput(entityIdSchema, leadId, 'lead-tasks.list.id')
    const response = await vimobAPIRequest<Envelope<LeadTask[]>>('/v1/lead-tasks', {
      query: { leadId: id },
    })
    validateDomainResponse(apiLeadTaskListResponseSchema, response, 'lead-tasks.list')
    return response.data
  },

  async create(task: {
    lead_id: string
    day_offset: number
    type: 'call' | 'message' | 'email' | 'note'
    title: string
    description?: string
    due_date?: string
  }, organizationId?: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const body = parseDomainInput(leadTaskCreateInputSchema, task, 'lead-tasks.create')
    const response = await vimobAPIRequest<Envelope<LeadTask>>('/v1/lead-tasks', {
      method: 'POST',
      ...requestIntent,
      organizationId,
      body,
    })
    validateDomainResponse(apiLeadTaskResponseSchema, response, 'lead-tasks.create')
    return response.data
  },

  async patch(id: string, input: { is_done?: boolean; outcome?: string; outcome_notes?: string; leadId?: string }, organizationId?: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const taskId = parseDomainInput(entityIdSchema, id, 'lead-tasks.patch.id')
    const body = parseDomainInput(leadTaskPatchInputSchema, input, 'lead-tasks.patch')
    const response = await vimobAPIRequest<Envelope<LeadTask>>(`/v1/lead-tasks/${taskId}`, {
      method: 'PATCH',
      ...requestIntent,
      organizationId,
      body,
    })
    validateDomainResponse(apiLeadTaskResponseSchema, response, 'lead-tasks.patch')
    return response.data
  },

  async completeCadence(input: CompleteCadenceTaskInput, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const { organizationId, ...completion } = input
    const body = parseDomainInput(
      cadenceTaskCompletionInputSchema,
      completion,
      'lead-tasks.complete-cadence',
    )
    const response = await vimobAPIRequest<Envelope<LeadTask>>('/v1/lead-tasks/complete-cadence', {
      method: 'POST',
      ...requestIntent,
      body,
      organizationId,
    })
    validateDomainResponse(apiLeadTaskResponseSchema, response, 'lead-tasks.complete-cadence')
    return response.data
  },
}
