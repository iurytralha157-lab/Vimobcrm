import {
  apiScheduleAssigneeListResponseSchema,
  apiScheduleCapabilitiesResponseSchema,
  apiScheduleCommentListResponseSchema,
  apiScheduleCommentResponseSchema,
  apiScheduleEventListResponseSchema,
  apiScheduleEventResponseSchema,
  completeScheduleEventInputSchema,
  createScheduleEventInputSchema,
  parseDomainInput,
  scheduleAssigneeInputSchema,
  scheduleCommentInputSchema,
  scheduleListQuerySchema,
  updateScheduleEventInputSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export type EventType = 'call' | 'email' | 'meeting' | 'task' | 'message' | 'visit'
export type ScheduleEventVisibility = 'default' | 'public' | 'private'
export type ScheduleRecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface ScheduleEvent {
  id: string
  organization_id: string
  user_id: string
  lead_id: string | null
  property_id: string | null
  title: string
  description: string | null
  event_type: string | null
  start_time: string
  end_time: string
  is_all_day: boolean | null
  location: string | null
  status: string | null
  visibility?: ScheduleEventVisibility | null
  reminder_minutes: number | null
  recurrence_parent_id?: string | null
  recurrence_rule?: string | null
  recurrence_until?: string | null
  recurrence_count?: number | null
  google_event_id: string | null
  completed_by: string | null
  completed_at: string | null
  created_at: string | null
  updated_at: string | null
  user?: {
    id: string
    name: string
    avatar_url: string | null
  } | null
  lead?: {
    id: string
    name: string
    phone: string | null
  } | null
  property?: {
    id: string
    title: string | null
    code: string | null
  } | null
  completed_by_user?: {
    id: string
    name: string
  } | null
  assignee_user_ids?: string[]
  is_masked?: boolean
}

export interface ScheduleComment {
  id: string
  event_id: string
  user_id: string
  organization_id: string
  content: string
  created_at: string
  user?: {
    id: string
    name: string
    avatar_url?: string | null
  }
}

export interface AssigneeUser {
  id: string
  name: string
  avatar_url: string | null
}

export type CreateScheduleEventInput = {
  title: string
  description?: string
  event_type?: EventType
  start_time: string
  end_time: string
  is_all_day?: boolean
  user_id?: string
  lead_id?: string
  property_id?: string | null
  location?: string
  visibility?: ScheduleEventVisibility
  recurrence_rule?: ScheduleRecurrenceFrequency
  reminder_minutes?: number | null
  assignee_ids?: string[]
}

export type UpdateScheduleEventInput = Partial<
  Pick<
    ScheduleEvent,
    | 'title'
    | 'description'
    | 'event_type'
    | 'start_time'
    | 'end_time'
    | 'is_all_day'
    | 'user_id'
    | 'lead_id'
    | 'property_id'
    | 'location'
    | 'status'
    | 'visibility'
    | 'reminder_minutes'
    | 'recurrence_rule'
  >
>

export const scheduleAPI = {
  async getScheduleEvents(params: {
    organizationId?: string | null
    eventId?: string
    userId?: string
    leadId?: string
    startDate?: Date
    endDate?: Date
  }) {
    const query = parseDomainInput(scheduleListQuerySchema, {
      eventId: params.eventId,
      userId: params.userId,
      leadId: params.leadId,
      startDate: params.startDate,
      endDate: params.endDate,
    }, 'schedule.events.list')
    const response = await vimobAPIRequest<Envelope<ScheduleEvent[]>>('/v1/schedule/events', {
      organizationId: params.organizationId,
      query: {
        eventId: query.eventId,
        userId: query.userId,
        leadId: query.leadId,
        startDate: query.startDate?.toISOString(),
        endDate: query.endDate?.toISOString(),
      },
    })
    validateDomainResponse(apiScheduleEventListResponseSchema, response, 'schedule.events.list')

    return response.data
  },

  async createScheduleEvent(organizationId: string | null | undefined, data: CreateScheduleEventInput) {
    const body = parseDomainInput(createScheduleEventInputSchema, normalizeScheduleEventBody(data), 'schedule.events.create')
    const response = await vimobAPIRequest<Envelope<ScheduleEvent>>('/v1/schedule/events', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiScheduleEventResponseSchema, response, 'schedule.events.create')

    return response.data
  },

  async updateScheduleEvent(eventId: string, data: UpdateScheduleEventInput, organizationId?: string | null) {
    const body = parseDomainInput(updateScheduleEventInputSchema, normalizeScheduleEventBody(data), 'schedule.events.update')
    const response = await vimobAPIRequest<Envelope<ScheduleEvent>>(`/v1/schedule/events/${eventId}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiScheduleEventResponseSchema, response, 'schedule.events.update')

    return response.data
  },

  async completeScheduleEvent(eventId: string, status: string, organizationId?: string | null) {
    const body = parseDomainInput(completeScheduleEventInputSchema, { status }, 'schedule.events.complete')
    const response = await vimobAPIRequest<Envelope<ScheduleEvent>>(`/v1/schedule/events/${eventId}/complete`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiScheduleEventResponseSchema, response, 'schedule.events.complete')

    return response.data
  },

  async deleteScheduleEvent(eventId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<ScheduleEvent>>(`/v1/schedule/events/${eventId}`, {
      method: 'DELETE',
      organizationId,
    })
    validateDomainResponse(apiScheduleEventResponseSchema, response, 'schedule.events.delete')

    return response.data
  },

  async getComments(eventId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<ScheduleComment[]>>(`/v1/schedule/events/${eventId}/comments`, {
      organizationId,
    })
    validateDomainResponse(apiScheduleCommentListResponseSchema, response, 'schedule.comments.list')

    return response.data
  },

  async addComment(eventId: string, content: string, organizationId?: string | null) {
    const body = parseDomainInput(scheduleCommentInputSchema, { content }, 'schedule.comments.create')
    const response = await vimobAPIRequest<Envelope<ScheduleComment>>(`/v1/schedule/events/${eventId}/comments`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiScheduleCommentResponseSchema, response, 'schedule.comments.create')

    return response.data
  },

  async getAssignees(eventId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AssigneeUser[]>>(`/v1/schedule/events/${eventId}/assignees`, {
      organizationId,
    })
    validateDomainResponse(apiScheduleAssigneeListResponseSchema, response, 'schedule.assignees.list')

    return response.data
  },

  async addAssignee(eventId: string, userId: string, organizationId?: string | null) {
    const body = parseDomainInput(scheduleAssigneeInputSchema, { user_id: userId }, 'schedule.assignees.add')
    const response = await vimobAPIRequest<Envelope<AssigneeUser[]>>(`/v1/schedule/events/${eventId}/assignees`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiScheduleAssigneeListResponseSchema, response, 'schedule.assignees.add')

    return response.data
  },

  async removeAssignee(eventId: string, userId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AssigneeUser[]>>(
      `/v1/schedule/events/${eventId}/assignees/${userId}`,
      {
        method: 'DELETE',
        organizationId,
      },
    )
    validateDomainResponse(apiScheduleAssigneeListResponseSchema, response, 'schedule.assignees.remove')

    return response.data
  },

  async getCapabilities(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<{ isTeamLeader: boolean }>>('/v1/schedule/capabilities', {
      organizationId,
    })
    validateDomainResponse(apiScheduleCapabilitiesResponseSchema, response, 'schedule.capabilities')

    return response.data
  },
}

function normalizeScheduleEventBody<T extends Record<string, unknown>>(data: T) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
}
