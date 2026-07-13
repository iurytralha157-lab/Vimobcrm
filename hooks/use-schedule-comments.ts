import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { scheduleAPI, type ScheduleComment } from '@/lib/api/schedule'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'

export type { ScheduleComment }

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useScheduleComments(eventId: string | undefined) {
  const { profile, organization } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const organizationId = organization?.id ?? profile?.organization_id

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
