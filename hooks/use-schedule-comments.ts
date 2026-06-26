import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { scheduleAPI, type ScheduleComment } from '@/lib/api/schedule'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'

export type { ScheduleComment }

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useScheduleComments(eventId: string | undefined) {
  const { profile } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['schedule_comments', profile?.organization_id, eventId],
    queryFn: async () => {
      if (!eventId) return []
      return scheduleAPI.getComments(eventId, profile?.organization_id)
    },
    enabled: !!eventId && !!profile?.organization_id,
  })

  const addCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!eventId) throw new Error('Evento nao identificado')
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada')
      return scheduleAPI.addComment(eventId, content, profile.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_comments', profile?.organization_id, eventId] })
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
