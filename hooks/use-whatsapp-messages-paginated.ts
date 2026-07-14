import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { whatsappAPI } from '@/lib/api/whatsapp'
import {
  flattenWhatsAppMessagePages,
  mergeWhatsAppMessagesWithLocalState,
  whatsappQueryKeys,
} from '@/lib/whatsapp-query-cache'
import type { WhatsAppMessage } from './use-whatsapp-conversations'
import { useWhatsAppQueryScope } from './use-whatsapp-query-scope'

const WHATSAPP_PAGINATED_MESSAGES_REFETCH_MS = 30_000

interface PaginatedMessagesResult {
  messages: WhatsAppMessage[]
  nextCursor: string | null
}

export function useWhatsAppMessagesPaginated(
  conversationId: string | null,
  options?: { pageSize?: number; refetchIntervalMs?: number | false },
) {
  const queryClient = useQueryClient()
  const scope = useWhatsAppQueryScope()
  const pageSize = options?.pageSize || 30
  const refreshInterval = options?.refetchIntervalMs ?? WHATSAPP_PAGINATED_MESSAGES_REFETCH_MS
  const queryKey = whatsappQueryKeys.paginatedMessages(scope, conversationId, pageSize)

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }): Promise<PaginatedMessagesResult> => {
      if (!conversationId) {
        return { messages: [], nextCursor: null }
      }

      const page = await whatsappAPI.getMessages({
        conversationId,
        organizationId: scope.organizationId,
        limit: pageSize,
        cursor: pageParam,
      })
      if (pageParam !== null) return page

      const cached = queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)
      const cachedMessages = cached?.pages[0]?.messages
      return {
        ...page,
        messages: mergeWhatsAppMessagesWithLocalState(page.messages, cachedMessages),
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    enabled: !!conversationId && !!scope.organizationId && !!scope.userId,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (currentQuery) => {
      if (refreshInterval === false) return false
      const data = currentQuery.state.data as InfiniteData<PaginatedMessagesResult> | undefined
      return (data?.pages.length ?? 0) <= 1 ? refreshInterval : false
    },
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })

  const allMessages = useMemo(
    () => flattenWhatsAppMessagePages(query.data?.pages ?? []),
    [query.data?.pages],
  )

  const retryMediaDownload = useCallback(async () => {
    queryClient.invalidateQueries({
      queryKey,
    })
  }, [queryClient, queryKey])

  return {
    ...query,
    messages: allMessages,
    hasOlderMessages: query.hasNextPage,
    loadOlderMessages: query.fetchNextPage,
    isLoadingOlder: query.isFetchingNextPage,
    retryMediaDownload,
  }
}
