import { vimobAPIRequest } from './vimob-client'
import type { LeadTask } from '@/hooks/use-lead-tasks'

type Envelope<T> = {
  data: T
}

export const leadTasksAPI = {
  async list(leadId: string) {
    const response = await vimobAPIRequest<Envelope<LeadTask[]>>('/v1/lead-tasks', {
      query: { leadId },
    })
    return response.data
  },

  async create(task: {
    lead_id: string
    day_offset: number
    type: 'call' | 'message' | 'email' | 'note'
    title: string
    description?: string
    due_date?: string
  }) {
    const response = await vimobAPIRequest<Envelope<LeadTask>>('/v1/lead-tasks', {
      method: 'POST',
      body: task,
    })
    return response.data
  },

  async patch(id: string, input: { is_done?: boolean; outcome?: string; outcome_notes?: string; leadId?: string }) {
    const response = await vimobAPIRequest<Envelope<LeadTask>>(`/v1/lead-tasks/${id}`, {
      method: 'PATCH',
      body: input,
    })
    return response.data
  },

  async completeCadence(input: {
    leadId: string
    templateTaskId: string
    dayOffset: number
    type: 'call' | 'message' | 'email' | 'note'
    title: string
    description?: string
    outcome?: string
    outcomeNotes?: string
  }) {
    const response = await vimobAPIRequest<Envelope<LeadTask>>('/v1/lead-tasks/complete-cadence', {
      method: 'POST',
      body: input,
    })
    return response.data
  },
}
