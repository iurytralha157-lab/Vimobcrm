import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { scheduleAPI, type ScheduleComment } from '@/lib/api/schedule'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error'

export type { ScheduleComment }

export function useScheduleComments(eventId: string | undefined) {
  const { activeOrganization, profile, organization } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const organizationId = activeOrganization.organizationId

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['schedule_comments', organizationId, eventId],
    queryFn: async () => {
      if (!eventId) return []
      return scheduleAPI.getComments(eventId, organizationId)
    },
    enabled: !!eventId && !!organizationId,
  })

  const addCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!eventId) throw new Error('Evento nao identificado')
      if (!organizationId) throw new Error('Organização não encontrada')
      return scheduleAPI.addComment(eventId, content, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_comments', organizationId, eventId] })
    },
    onError: (error) => {
      toast({
        title: 'Erro ao adicionar comentario',
        description: getErrorMessage(error),
        variant: 'destructive',
      })
    },
  })

  return {
    comments,
    isLoading,
    addComment: addCommentMutation.mutate,
    isAdding: addCommentMutation.isPending,
  }
}
