import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { scheduleAPI, type ScheduleComment } from '@/lib/api/schedule'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error'
import { refreshScheduleQueries } from '@/hooks/schedule/schedule-query-refresh'

export type { ScheduleComment }

export function useScheduleComments(eventId: string | undefined) {
  const { activeOrganization } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const organizationId = activeOrganization.organizationId
  const requestRef = useRef<{ signature: string; id: string } | null>(null)

  const { data: comments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['schedule_comments', organizationId, eventId],
    queryFn: async () => {
      if (!eventId) return []
      return scheduleAPI.getComments(eventId, organizationId)
    },
    enabled: !!eventId && !!organizationId,
    refetchOnMount: true,
  })

  const addCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!eventId) throw new Error('Evento nao identificado')
      if (!organizationId) throw new Error('Organização não encontrada')
      const signature = JSON.stringify([organizationId, eventId, content])
      if (requestRef.current?.signature !== signature) {
        requestRef.current = { signature, id: crypto.randomUUID() }
      }
      return scheduleAPI.addComment(eventId, content, organizationId, requestRef.current.id)
    },
    onSuccess: () => {
      requestRef.current = null
      void refreshScheduleQueries(queryClient, { queryKey: ['schedule_comments', organizationId, eventId] })
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
    isError,
    refetch,
    addComment: addCommentMutation.mutate,
    isAdding: addCommentMutation.isPending,
  }
}
