import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { scheduleAPI, type AssigneeUser } from '@/lib/api/schedule'
import { syncScheduleEventWithGoogle } from '@/lib/api/google-calendar'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { getFriendlyErrorMessage } from '@/lib/error-handler'

export type { AssigneeUser }

export function useScheduleEventAssignees(eventId: string | undefined) {
  const queryClient = useQueryClient()
  const { profile, organization } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id

  const syncAssigneesWithGoogle = () => {
    if (!eventId) return
    void syncScheduleEventWithGoogle('push_upsert', eventId, organizationId)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['google-calendar-status'] })
        queryClient.invalidateQueries({ queryKey: ['schedule-events'] })
      })
      .catch((error) => {
        console.warn('Google Calendar assignee sync skipped:', error)
      })
  }

  const { data: assignees = [], isLoading } = useQuery({
    queryKey: ['schedule_assignees', organizationId, eventId],
    queryFn: async () => {
      if (!eventId) return []
      return scheduleAPI.getAssignees(eventId, organizationId)
    },
    enabled: !!eventId && !!organizationId,
  })

  const addAssignee = useMutation({
    mutationFn: async (userId: string) => {
      if (!eventId || !organizationId) throw new Error('Dados insuficientes')
      return scheduleAPI.addAssignee(eventId, userId, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_assignees', organizationId, eventId] })
      queryClient.invalidateQueries({ queryKey: ['schedule-events'] })
      syncAssigneesWithGoogle()
    },
    onError: (error) => toast.error(getFriendlyErrorMessage(error)),
  })

  const removeAssignee = useMutation({
    mutationFn: async (userId: string) => {
      if (!eventId || !organizationId) throw new Error('Dados insuficientes')
      return scheduleAPI.removeAssignee(eventId, userId, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_assignees', organizationId, eventId] })
      queryClient.invalidateQueries({ queryKey: ['schedule-events'] })
      syncAssigneesWithGoogle()
    },
    onError: (error) => toast.error(getFriendlyErrorMessage(error)),
  })

  return {
    assignees,
    isLoading,
    addAssignee: addAssignee.mutateAsync,
    removeAssignee: removeAssignee.mutateAsync,
  }
}
