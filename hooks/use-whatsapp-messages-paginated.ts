import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { whatsappAPI } from '@/lib/api/whatsapp'
import type { WhatsAppMessage } from './use-whatsapp-conversations'

interface PaginatedMessagesResult {
  messages: WhatsAppMessage[]
  nextCursor: string | null
}

export function useWhatsAppMessagesPaginated(
  conversationId: string | null,
  options?: { pageSize?: number },
) {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const pageSize = options?.pageSize || 30

  const query = useInfiniteQuery({
    queryKey: ['whatsapp-messages-paginated', conversationId],
    queryFn: async ({ pageParam }): Promise<PaginatedMessagesResult> => {
      if (!conversationId) {
        return { messages: [], nextCursor: null }
      }

      return whatsappAPI.getMessages({
        conversationId,
        organizationId: profile?.organization_id,
        limit: pageSize,
        cursor: pageParam,
      })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    enabled: !!conversationId && !!profile?.organization_id,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  const allMessages = useMemo(
    () => query.data?.pages.flatMap((page) => page.messages) || [],
    [query.data?.pages],
  )

  const retryMediaDownload = useCallback(async () => {
    queryClient.invalidateQueries({
      queryKey: ['whatsapp-messages-paginated', conversationId],
    })
  }, [conversationId, queryClient])

  return {
    ...query,
    messages: allMessages,
    hasOlderMessages: query.hasNextPage,
    loadOlderMessages: query.fetchNextPage,
    isLoadingOlder: query.isFetchingNextPage,
    retryMediaDownload,
  }
}
