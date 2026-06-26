import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { scheduleAPI, type AssigneeUser } from '@/lib/api/schedule'
import { useAuth } from '@/contexts/AuthContext'

export type { AssigneeUser }

export function useScheduleEventAssignees(eventId: string | undefined) {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const { data: assignees = [], isLoading } = useQuery({
    queryKey: ['schedule_assignees', profile?.organization_id, eventId],
    queryFn: async () => {
      if (!eventId) return []
      return scheduleAPI.getAssignees(eventId, profile?.organization_id)
    },
    enabled: !!eventId && !!profile?.organization_id,
  })

  const addAssignee = useMutation({
    mutationFn: async (userId: string) => {
      if (!eventId || !profile?.organization_id) throw new Error('Dados insuficientes')
      return scheduleAPI.addAssignee(eventId, userId, profile.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_assignees', profile?.organization_id, eventId] })
      queryClient.invalidateQueries({ queryKey: ['schedule-events'] })
    },
  })

  const removeAssignee = useMutation({
    mutationFn: async (userId: string) => {
      if (!eventId || !profile?.organization_id) throw new Error('Dados insuficientes')
      return scheduleAPI.removeAssignee(eventId, userId, profile.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_assignees', profile?.organization_id, eventId] })
      queryClient.invalidateQueries({ queryKey: ['schedule-events'] })
    },
  })

  return {
    assignees,
    isLoading,
    addAssignee: addAssignee.mutate,
    removeAssignee: removeAssignee.mutate,
  }
}
