import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
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

export function useScheduleEvents(options: UseScheduleEventsOptions = {}) {
  const { profile } = useAuth()

  return useQuery({
    queryKey: ['schedule-events', profile?.organization_id, options],
    queryFn: () =>
      scheduleAPI.getScheduleEvents({
        organizationId: profile?.organization_id,
        userId: options.userId,
        leadId: options.leadId,
        startDate: options.startDate,
        endDate: options.endDate,
      }),
    enabled: !!profile?.organization_id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useScheduleCapabilities() {
  const { profile } = useAuth()

  return useQuery({
    queryKey: ['schedule-capabilities', profile?.organization_id, profile?.id],
    queryFn: () => scheduleAPI.getCapabilities(profile?.organization_id),
    enabled: !!profile?.organization_id && !!profile?.id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCreateScheduleEvent() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (event: CreateScheduleEventInput) => {
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada')
      return scheduleAPI.createScheduleEvent(profile.organization_id, event)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
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
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<
      Omit<
        ScheduleEvent,
        'id' | 'user' | 'lead' | 'property' | 'completed_by_user' | 'assignee_user_ids' | 'is_masked' | 'visibility'
      >
    > & {
      id: string
      visibility?: ScheduleEventVisibility
    }) => {
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada')
      return scheduleAPI.updateScheduleEvent(id, toScheduleUpdateBody(updates), profile.organization_id)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
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
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada')
      return scheduleAPI.completeScheduleEvent(id, status, profile.organization_id)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
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
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada')
      return scheduleAPI.deleteScheduleEvent(id, profile.organization_id)
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id)
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
