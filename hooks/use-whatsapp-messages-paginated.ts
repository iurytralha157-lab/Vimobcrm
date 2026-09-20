import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { whatsappAPI } from '@/lib/api/whatsapp'
import {
  flattenWhatsAppMessagePages,
  mergeWhatsAppLatestMessagePage,
  mergeWhatsAppMessagesWithLocalState,
  shouldRebaseWhatsAppMessagePages,
  WHATSAPP_MESSAGES_RECONCILE_EVENT,
  whatsappQueryKeys,
  type WhatsAppMessagesReconcileEventDetail,
} from '@/lib/whatsapp-query-cache'
import type { WhatsAppMessage } from './use-whatsapp-conversations'
import { useWhatsAppQueryScope } from './use-whatsapp-query-scope'

const WHATSAPP_PAGINATED_MESSAGES_REFETCH_MS = 30_000
const WHATSAPP_HEAD_REFRESH_MIN_GAP_MS = 1_000

interface PaginatedMessagesResult {
  messages: WhatsAppMessage[]
  nextCursor: string | null
}

const latestPageRequests = new Map<string, Promise<PaginatedMessagesResult>>()

export function useWhatsAppMessagesPaginated(
  conversationId: string | null,
  options?: {
    pageSize?: number
    refetchIntervalMs?: number | false
    includeMediaUrls?: boolean
    expectedLeadId?: string | null
	historyLeadId?: string | null
  },
) {
  const queryClient = useQueryClient()
  const scope = useWhatsAppQueryScope()
  const pageSize = options?.pageSize || 30
  const includeMediaUrls = options?.includeMediaUrls ?? true
  const expectedLeadId = options?.expectedLeadId ?? null
	const historyLeadId = options?.historyLeadId ?? null
  const refreshInterval = options?.refetchIntervalMs ?? WHATSAPP_PAGINATED_MESSAGES_REFETCH_MS
	const queryEnabled = !!conversationId && !!expectedLeadId && !!scope.organizationId && !!scope.userId
  const queryKey = useMemo(
    () => [
      ...whatsappQueryKeys.paginatedMessages(scope, conversationId, pageSize, expectedLeadId),
	  historyLeadId ? `lead-history:${historyLeadId}` : 'current-conversation',
      includeMediaUrls ? 'with-media-urls' : 'lazy-media-urls',
    ] as const,
	[conversationId, expectedLeadId, historyLeadId, includeMediaUrls, pageSize, scope],
  )
  const queryFingerprint = useMemo(() => JSON.stringify(queryKey), [queryKey])
  const refreshStateRef = useRef({ key: queryFingerprint, lastStartedAt: 0 })
  const refreshedOnMountKeyRef = useRef<string | null>(null)
	const fetchPage = useCallback(async (cursor: string | null): Promise<PaginatedMessagesResult> => {
	  if (!conversationId || !expectedLeadId) return { messages: [], nextCursor: null }
	  if (historyLeadId) {
		const history = await whatsappAPI.getHistoryAccess({
		  conversationId,
		  leadId: historyLeadId,
		  organizationId: scope.organizationId,
		  limit: pageSize,
		  cursor,
		})
		return {
		  messages: history.messages,
		  nextCursor: history.nextCursor ?? null,
		}
	  }
	  return whatsappAPI.getMessages({
		conversationId,
		organizationId: scope.organizationId,
		limit: pageSize,
		cursor,
		includeMediaUrls,
		expectedLeadId,
	  }) as Promise<PaginatedMessagesResult>
	}, [conversationId, expectedLeadId, historyLeadId, includeMediaUrls, pageSize, scope.organizationId])

  const refreshLatestPage = useCallback(async (minimumGapMs = WHATSAPP_HEAD_REFRESH_MIN_GAP_MS) => {
    if (!queryEnabled || !conversationId) return

    const refreshState = refreshStateRef.current
    if (refreshState.key !== queryFingerprint) {
      refreshState.key = queryFingerprint
      refreshState.lastStartedAt = 0
    }

    const now = Date.now()
    if (now - refreshState.lastStartedAt < minimumGapMs) return
    if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') return
    refreshState.lastStartedAt = now

    let request = latestPageRequests.get(queryFingerprint)
    if (!request) {
	  request = fetchPage(null)
      latestPageRequests.set(queryFingerprint, request)
      void request.then(
        () => latestPageRequests.delete(queryFingerprint),
        () => latestPageRequests.delete(queryFingerprint),
      )
    }

    try {
      const latestPage = await request
      const cachedBeforeRefresh = queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)
      if (
        cachedBeforeRefresh?.pages[0]
        && shouldRebaseWhatsAppMessagePages(
          cachedBeforeRefresh.pages[0].messages,
          latestPage.messages,
        )
      ) {
        if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') return
        await queryClient.refetchQueries(
          { queryKey, exact: true, type: 'active' },
          { cancelRefetch: false },
        )

        const rebased = queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)
        if (!rebased?.pages[0]) return
        const previousMessages = flattenWhatsAppMessagePages(cachedBeforeRefresh.pages)
        const rebasedMessages = flattenWhatsAppMessagePages(rebased.pages)
        if (shouldRebaseWhatsAppMessagePages(previousMessages, rebasedMessages)) return

        const historySources = [
          cachedBeforeRefresh.pages[0],
          ...rebased.pages.slice(1),
          ...cachedBeforeRefresh.pages.slice(1),
        ]
        const mergedPages = mergeWhatsAppLatestMessagePage(
          historySources,
          rebased.pages[0],
          { pageSize },
        )
        queryClient.setQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey, {
          ...rebased,
          pages: mergedPages,
          pageParams: mergedPages.map((_, index) => rebased.pageParams[index] ?? null),
        })
        return
      }

      queryClient.setQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey, (cached) => {
        if (!cached?.pages.length) return cached
        const mergedPages = mergeWhatsAppLatestMessagePage(
          cached.pages,
          latestPage,
          { pageSize },
        )
        return {
          ...cached,
          pages: mergedPages,
          pageParams: mergedPages.map((_, index) => cached.pageParams[index] ?? null),
        }
      })
    } catch {
      // Polling and wake-up reconciliation are best effort. The regular query
      // keeps its last canonical data and exposes initial-load failures.
    }
	}, [conversationId, fetchPage, pageSize, queryClient, queryEnabled, queryFingerprint, queryKey])

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }): Promise<PaginatedMessagesResult> => {
      if (!conversationId) {
        return { messages: [], nextCursor: null }
      }

	  const page = await fetchPage(pageParam)
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
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000,
    // Infinite-query refetches walk every loaded cursor page. Recent-message
    // reconciliation is handled below so loading history never disables the
    // safety poll or repeatedly downloads old pages.
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!queryEnabled || refreshedOnMountKeyRef.current === queryFingerprint) return
    refreshedOnMountKeyRef.current = queryFingerprint
    if (!queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)) return
    void refreshLatestPage(0)
  }, [queryClient, queryEnabled, queryFingerprint, queryKey, refreshLatestPage])

  useEffect(() => {
    if (!queryEnabled) return

    const canRefresh = () => document.visibilityState === 'visible' && navigator.onLine !== false
    const reconcile = () => {
      if (!canRefresh()) return
      void refreshLatestPage()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    const handleReconcileEvent = (event: Event) => {
      const detail = (event as CustomEvent<WhatsAppMessagesReconcileEventDetail>).detail
      if (detail?.conversationIds?.length && !detail.conversationIds.includes(conversationId!)) return
      reconcile()
    }

    window.addEventListener('focus', reconcile)
    window.addEventListener('online', reconcile)
    window.addEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, handleReconcileEvent)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const intervalMs = refreshInterval === false
      ? null
      : Math.max(refreshInterval, WHATSAPP_HEAD_REFRESH_MIN_GAP_MS)
    const interval = intervalMs
      ? window.setInterval(reconcile, intervalMs)
      : null

    return () => {
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('online', reconcile)
      window.removeEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, handleReconcileEvent)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [conversationId, queryEnabled, refreshInterval, refreshLatestPage])

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
