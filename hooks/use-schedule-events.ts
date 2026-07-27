import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import {
  syncScheduleEventWithGoogle,
  type GoogleCalendarSyncAction,
} from '@/lib/api/google-calendar'
import { getFriendlyErrorMessage } from '@/lib/error-handler'
import {
  scheduleAPI,
  type CreateScheduleEventInput,
  type EventType,
  type ScheduleEvent,
  type ScheduleEventVisibility,
  type ScheduleRecurrenceFrequency,
  type UpdateScheduleEventInput,
} from '@/lib/api/schedule'

export type {
  EventType,
  ScheduleEvent,
  ScheduleEventVisibility,
  ScheduleRecurrenceFrequency,
}

interface UseScheduleEventsOptions {
  enabled?: boolean
  eventId?: string
  userId?: string
  leadId?: string
  startDate?: Date
  endDate?: Date
}

function invalidateScheduleCaches(queryClient: ReturnType<typeof useQueryClient>, leadId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ['schedule-events'] })
  if (leadId) {
    queryClient.invalidateQueries({ queryKey: ['activities', leadId] })
    queryClient.invalidateQueries({ queryKey: ['activities'] })
    queryClient.invalidateQueries({ queryKey: ['recent-activities'] })
    queryClient.invalidateQueries({ queryKey: ['lead-history-v2', leadId] })
    queryClient.invalidateQueries({ queryKey: ['lead-timeline', leadId] })
  }
}

async function syncGoogleCalendarEvent(action: GoogleCalendarSyncAction, eventId: string, organizationId?: string | null) {
  try {
    await syncScheduleEventWithGoogle(action, eventId, organizationId)
  } catch (error) {
    console.warn('Google Calendar schedule sync skipped:', error)
  }
}

function syncGoogleCalendarEventInBackground(
  queryClient: ReturnType<typeof useQueryClient>,
  action: GoogleCalendarSyncAction,
  eventId?: string | null,
  organizationId?: string | null,
) {
  if (!eventId) return
  void syncGoogleCalendarEvent(action, eventId, organizationId).then(() => {
    queryClient.invalidateQueries({ queryKey: ['google-calendar-status'] })
    queryClient.invalidateQueries({ queryKey: ['schedule-events'] })
  })
}

export function useScheduleEvents(options: UseScheduleEventsOptions = {}) {
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  return useQuery({
    queryKey: ['schedule-events', organizationId, options],
    queryFn: () =>
      scheduleAPI.getScheduleEvents({
        organizationId,
        eventId: options.eventId,
        userId: options.userId,
        leadId: options.leadId,
        startDate: options.startDate,
        endDate: options.endDate,
      }),
    enabled: !!organizationId && options.enabled !== false,
    staleTime: 1000 * 60 * 5,
  })
}

export function useScheduleCapabilities() {
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  return useQuery({
    queryKey: ['schedule-capabilities', organizationId, profile?.id],
    queryFn: () => scheduleAPI.getCapabilities(organizationId),
    enabled: !!organizationId && !!profile?.id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCreateScheduleEvent() {
  const queryClient = useQueryClient()
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  return useMutation({
    mutationFn: async (event: CreateScheduleEventInput) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return scheduleAPI.createScheduleEvent(organizationId, event)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
      syncGoogleCalendarEventInBackground(queryClient, 'push_upsert', data?.id, organizationId)
      toast.success('Atividade criada com sucesso!')
    },
    onError: (error: Error) => {
      console.error('Error creating schedule event:', error)
      toast.error(getFriendlyErrorMessage(error))
    },
  })
}

export function useUpdateScheduleEvent() {
  const queryClient = useQueryClient()
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<
      Omit<
        ScheduleEvent,
        | 'id'
        | 'user'
        | 'lead'
        | 'property'
        | 'completed_by_user'
        | 'assignee_user_ids'
        | 'is_masked'
        | 'visibility'
        | 'user_id'
      >
    > & {
      id: string
      visibility?: ScheduleEventVisibility
      user_id?: string
    }) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return scheduleAPI.updateScheduleEvent(id, toScheduleUpdateBody(updates), organizationId)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
      syncGoogleCalendarEventInBackground(queryClient, 'push_upsert', data?.id, organizationId)
      toast.success('Atividade atualizada!')
    },
    onError: (error: Error) => {
      console.error('Error updating schedule event:', error)
      toast.error(getFriendlyErrorMessage(error))
    },
  })
}

export function useCompleteScheduleEvent() {
  const queryClient = useQueryClient()
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return scheduleAPI.completeScheduleEvent(id, status, organizationId)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
      syncGoogleCalendarEventInBackground(queryClient, 'push_upsert', data?.id, organizationId)
      toast.success(data.status === 'completed' ? 'Atividade concluida!' : 'Atividade reaberta')
    },
    onError: (error: Error) => {
      console.error('Error completing schedule event:', error)
      toast.error(getFriendlyErrorMessage(error))
    },
  })
}

export function useDeleteScheduleEvent() {
  const queryClient = useQueryClient()
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      await syncGoogleCalendarEvent('push_delete', id, organizationId)
      return scheduleAPI.deleteScheduleEvent(id, organizationId)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
      queryClient.invalidateQueries({ queryKey: ['google-calendar-status'] })
      toast.success('Atividade removida!')
    },
    onError: (error: Error) => {
      console.error('Error deleting schedule event:', error)
      toast.error(getFriendlyErrorMessage(error))
    },
  })
}

function toScheduleUpdateBody(updates: Record<string, unknown>): UpdateScheduleEventInput {
  const allowedKeys = new Set([
    'title',
    'description',
    'event_type',
    'start_time',
    'end_time',
    'is_all_day',
    'user_id',
    'lead_id',
    'property_id',
    'location',
    'status',
    'visibility',
    'reminder_minutes',
    'recurrence_rule',
  ])

  return Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => allowedKeys.has(key) && value !== undefined),
  ) as UpdateScheduleEventInput
}
