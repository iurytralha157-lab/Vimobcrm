import { CancelledError, useInfiniteQuery, useQueryClient, type InfiniteData, type Query, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { whatsappAPI } from '@/lib/api/whatsapp'
import {
  flattenWhatsAppMessagePages,
  mergeWhatsAppHistoricalMessagePage,
  mergeWhatsAppLatestMessagePage,
  mergeWhatsAppMessagesWithLocalState,
  shouldRebaseWhatsAppMessagePages,
  WHATSAPP_MESSAGES_RECONCILE_EVENT,
  whatsappQueryKeys,
  type WhatsAppMessagesReconcileEventDetail,
} from '@/lib/whatsapp-query-cache'
import type { WhatsAppMessage } from './use-whatsapp-conversations'
import { useWhatsAppQueryScope } from './use-whatsapp-query-scope'
import { clearUnavailableWhatsAppMessageCache, isWhatsAppAccessUnavailable } from '@/lib/whatsapp-access-revocation'
import { isWhatsAppMessageCursorRebaseRequired } from '@/lib/whatsapp-message-order'
import { captureWhatsAppCanonicalConversationPreview, type WhatsAppCanonicalConversationPreview } from '@/lib/whatsapp-canonical-conversation-preview'

const WHATSAPP_PAGINATED_MESSAGES_REFETCH_MS = 30_000
const WHATSAPP_HEAD_REFRESH_MIN_GAP_MS = 1_000
const WHATSAPP_HISTORY_REFRESH_MIN_GAP_MS = 30_000
const WHATSAPP_HISTORY_REFRESH_BATCH_PAGES = 4
const WHATSAPP_HISTORY_REFRESH_BATCH_GAP_MS = 1_000

export interface PaginatedMessagesResult {
  messages: WhatsAppMessage[]
  nextCursor: string | null
}

type HistoricalMessageRefresh = {
  query: Query
  controller: AbortController
  generation: number
  nextCursor: string | null
  remainingPages: number
  oldestAliases: Set<string>
  seenCursors: Set<string>
  snapshotMessages: WhatsAppMessage[]
}

type HeadRead = { query: Query; state: HeadReadState; queryFetch?: Promise<unknown>; controller?: AbortController }
type HeadRequest = { read: HeadRead; promise: Promise<PaginatedMessagesResult>; handled?: boolean }
type HeadReadOwner = {
  generation: () => number
  available: () => boolean
  onPage: (page: PaginatedMessagesResult, read: HeadRead | null, generation: number, custom?: boolean) => void
  onError: (error: unknown, cursor: string | null, generation: number, custom?: boolean) => boolean
  onRefreshState: (phase: 'rebase' | 'history-complete', generation: number) => void
  onHistory: (page: PaginatedMessagesResult, generation: number) => void
}
type HeadReadState = {
  current: HeadRead | null; pending?: HeadRequest; owners: Map<object, HeadReadOwner>
}
// Both surfaces share read ownership, but never across QueryClients or a Query
// removed/recreated with the same key. Weak keys follow Query cache lifetime.
const headReadStates = new WeakMap<QueryClient, WeakMap<Query, HeadReadState>>()
function headReadState(client: QueryClient, query: Query): HeadReadState {
  let queries = headReadStates.get(client)
  if (!queries) { queries = new WeakMap(); headReadStates.set(client, queries) }
  let state = queries.get(query)
  if (!state) { state = { current: null, owners: new Map() }; queries.set(query, state) }
  return state
}
function startHeadRead(client: QueryClient, query: Query, fromQuery = false): HeadRead {
  const state = headReadState(client, query)
  // A custom HEAD is not owned by React Query's cancellation signal. Keep its
  // controller on the shared ticket so one surface cannot cancel its peer.
  state.current?.controller?.abort()
  const read = { query, state, queryFetch: fromQuery ? query.promise : undefined,
    controller: fromQuery ? undefined : new AbortController() }
  state.current = read
  if (fromQuery) state.pending = undefined
  return read
}
function snapshotHeadOwners(state: HeadReadState) {
  return [...state.owners.values()].map((owner) => ({ owner, generation: owner.generation() }))
}

export function useWhatsAppMessagesPaginated(
  conversationId: string | null,
  options?: {
    pageSize?: number
    refetchIntervalMs?: number | false
    includeMediaUrls?: boolean
    expectedLeadId?: string | null

    expectedSessionId?: string | null
	historyLeadId?: string | null
    onConversationUnavailable?: (conversationId: string, expectedLeadId?: string | null) => void
  },
) {
  const queryClient = useQueryClient()
  const sourceScope = useWhatsAppQueryScope()
  // Equal tenant/permission values must not dispose a queued head refresh
  // merely because the auth provider emitted a new context object.
  const scope = useMemo(() => ({
    organizationId: sourceScope.organizationId,
    userId: sourceScope.userId,
    accessScope: sourceScope.accessScope,
  }), [sourceScope.organizationId, sourceScope.userId, sourceScope.accessScope])
  const pageSize = options?.pageSize || 30
  const includeMediaUrls = options?.includeMediaUrls ?? true
  const expectedLeadId = options?.expectedLeadId ?? null
  const expectedSessionId = options?.expectedSessionId ?? null
	const historyLeadId = options?.historyLeadId ?? null
  const onConversationUnavailable = options?.onConversationUnavailable
  const unavailableCallbackRef = useRef(onConversationUnavailable)
  useLayoutEffect(() => {
    unavailableCallbackRef.current = onConversationUnavailable
  }, [onConversationUnavailable])
  const refreshInterval = options?.refetchIntervalMs ?? WHATSAPP_PAGINATED_MESSAGES_REFETCH_MS

  const [cursorGeneration, setCursorGeneration] = useState(0)
  const cursorRebasedIdentityRef = useRef<string | null>(null)
	const queryEnabled = !!conversationId && !!expectedLeadId && !!scope.organizationId && !!scope.userId
  const queryKey = useMemo(
    () => [
      ...whatsappQueryKeys.paginatedMessages(scope, conversationId, pageSize, expectedLeadId),
	  historyLeadId ? `lead-history:${historyLeadId}` : 'current-conversation',
      includeMediaUrls ? 'with-media-urls' : 'lazy-media-urls',
      `expected-session:${expectedSessionId ?? 'none'}`,
      `cursor-generation:${cursorGeneration}`,
    ] as const,
	[conversationId, cursorGeneration, expectedLeadId, expectedSessionId, historyLeadId, includeMediaUrls, pageSize, scope],
  )
  const queryFingerprint = useMemo(() => JSON.stringify(queryKey), [queryKey])
  const canonicalPreviewOwner = useMemo(() => ({ fingerprint: queryFingerprint }), [queryFingerprint])
  const cursorIdentity = useMemo(() => JSON.stringify(queryKey.slice(0, -1)), [queryKey])
  const currentFingerprintRef = useRef(queryFingerprint)
  const requestGenerationRef = useRef(0)
  const headOwnerRef = useRef<{ query: Query; state: HeadReadState } | null>(null)
  const [canonicalHead, setCanonicalHead] = useState<{
    owner: typeof canonicalPreviewOwner; preview: WhatsAppCanonicalConversationPreview
  } | null>(null)
  const pageReadControllersRef = useRef(new Set<AbortController>())
  const historyRefreshRef = useRef<HistoricalMessageRefresh | null>(null)
  const historyTimerRef = useRef<number | null>(null)
  const historyRefreshClockRef = useRef({ fingerprint: queryFingerprint, lastStartedAt: 0 })
  const historyTrailingRef = useRef(false)
  const [reconciliationFailure, setReconciliationFailure] = useState<{
    fingerprint: string; head: unknown | null; history: unknown | null
  } | null>(null)
  const currentQuery = useCallback(() => queryClient.getQueryCache().find({ queryKey, exact: true }), [queryClient, queryKey])
  const isCurrentHeadRead = useCallback((read: HeadRead | null): read is HeadRead => Boolean(read
    && read.state.current === read && currentQuery() === read.query), [currentQuery])
  const pendingHeadRequest = useCallback(() => {
    const query = currentQuery()
    const pending = query ? headReadState(queryClient, query).pending : undefined
    return pending && isCurrentHeadRead(pending.read) ? pending : undefined
  }, [currentQuery, isCurrentHeadRead, queryClient])
  const retireHeadReads = useCallback(() => {
    const query = currentQuery()
    if (!query) return
    const state = headReadState(queryClient, query)
    state.current?.controller?.abort()
    state.current = null; state.pending = undefined
  }, [currentQuery, queryClient])
  const releaseHeadOwner = useCallback(() => {
    const owned = headOwnerRef.current
    if (!owned) return
    headOwnerRef.current = null
    owned.state.owners.delete(canonicalPreviewOwner)
    if (owned.state.owners.size) return
    owned.state.current?.controller?.abort()
    owned.state.current = null; owned.state.pending = undefined
    void queryClient.cancelQueries({ predicate: (query) => query === owned.query })
  }, [canonicalPreviewOwner, queryClient])
  const abortHistoricalRefresh = useCallback(() => {
    historyRefreshRef.current?.controller.abort()
    historyRefreshRef.current = null
    historyTrailingRef.current = false
    if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = null
  }, [])
  const abortPageReads = useCallback(() => {
    pageReadControllersRef.current.forEach((controller) => controller.abort())
    pageReadControllersRef.current.clear()
  }, [])
  const updateReconciliationFailure = useCallback((kind: 'head' | 'history', error: unknown | null) => {
    if (error !== null) setCanonicalHead(null)
    setReconciliationFailure((previous) => ({
      fingerprint: queryFingerprint,
      head: previous?.fingerprint === queryFingerprint ? previous.head : null,
      history: previous?.fingerprint === queryFingerprint ? previous.history : null,
      [kind]: error,
    }))
  }, [queryFingerprint])
  useLayoutEffect(() => {
    currentFingerprintRef.current = queryFingerprint
    requestGenerationRef.current += 1
    return () => {
      currentFingerprintRef.current = ''
      requestGenerationRef.current += 1
      abortHistoricalRefresh()
      abortPageReads()
      releaseHeadOwner()
    }
  }, [abortHistoricalRefresh, abortPageReads, queryFingerprint, releaseHeadOwner])
  const unavailableFingerprintRef = useRef<string | null>(null)
  const [unavailableFingerprint, setUnavailableFingerprint] = useState<string | null>(null)
  const notifyUnavailable = useCallback((error: unknown) => {
    if (!conversationId || !isWhatsAppAccessUnavailable(error)
      || currentFingerprintRef.current !== queryFingerprint
      || unavailableFingerprintRef.current === queryFingerprint) return
    setCanonicalHead(null)
    requestGenerationRef.current += 1
    abortHistoricalRefresh()
    abortPageReads()
    retireHeadReads()
    unavailableFingerprintRef.current = queryFingerprint
    setUnavailableFingerprint(queryFingerprint)
    clearUnavailableWhatsAppMessageCache(queryClient, scope, conversationId, historyLeadId || expectedLeadId)
    unavailableCallbackRef.current?.(conversationId, expectedLeadId)
  }, [abortHistoricalRefresh, abortPageReads, conversationId, expectedLeadId, historyLeadId, queryClient, queryFingerprint, retireHeadReads, scope])
  const refreshStateRef = useRef({ key: queryFingerprint, lastStartedAt: 0 })
  const refreshedOnMountKeyRef = useRef<string | null>(null)
  const captureRawHead = useCallback((page: PaginatedMessagesResult, generation: number, readToken: HeadRead | null, signal?: AbortSignal) => {
    if (currentFingerprintRef.current !== queryFingerprint || requestGenerationRef.current !== generation
      || unavailableFingerprintRef.current === queryFingerprint || signal?.aborted
      || !isCurrentHeadRead(readToken)) return
    const preview = captureWhatsAppCanonicalConversationPreview(page.messages, {
      scope, conversationId, expectedLeadId, expectedSessionId, historyLeadId,
    })
    setCanonicalHead(preview ? { owner: canonicalPreviewOwner, preview } : null)
  }, [canonicalPreviewOwner, conversationId, expectedLeadId, expectedSessionId, historyLeadId, isCurrentHeadRead, queryFingerprint, scope])
	const fetchPage = useCallback(async (cursor: string | null, signal?: AbortSignal): Promise<PaginatedMessagesResult> => {
	  if (!conversationId || !expectedLeadId) return { messages: [], nextCursor: null }
	  if (historyLeadId) {
		const history = await whatsappAPI.getHistoryAccess({
		  conversationId,
		  leadId: historyLeadId,
		  organizationId: scope.organizationId,
		  limit: pageSize,
		  cursor,
		  includeMediaUrls,
		}, { signal, expectedUserId: scope.userId })
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
	  }, { signal, expectedUserId: scope.userId }) as Promise<PaginatedMessagesResult>
	}, [conversationId, expectedLeadId, historyLeadId, includeMediaUrls, pageSize, scope.organizationId, scope.userId])

  const rebaseExpiredCursor = useCallback(() => {
    if (cursorRebasedIdentityRef.current === cursorIdentity) return false
    setCanonicalHead(null)
    cursorRebasedIdentityRef.current = cursorIdentity
    requestGenerationRef.current += 1
    abortHistoricalRefresh()
    abortPageReads()
    retireHeadReads()
    queryClient.removeQueries({ queryKey, exact: true })
    setCursorGeneration((generation) => generation + 1)
    return true
  }, [abortHistoricalRefresh, abortPageReads, cursorIdentity, queryClient, queryKey, retireHeadReads])

  // Search/quote navigation reads the same authorized projection, but does not
  // append its results to the currently displayed/cache-loaded window.
  const readMessagePage = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    const generation = requestGenerationRef.current
    if (!queryEnabled || currentFingerprintRef.current !== queryFingerprint
      || unavailableFingerprintRef.current === queryFingerprint || signal?.aborted) {
      throw new CancelledError({ silent: true })
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    pageReadControllersRef.current.add(controller)
    const isCurrent = () => !controller.signal.aborted && currentFingerprintRef.current === queryFingerprint
      && generation === requestGenerationRef.current && unavailableFingerprintRef.current !== queryFingerprint
    try {
      if (!isCurrent()) throw new CancelledError({ silent: true })
      const page = await fetchPage(cursor, controller.signal)
      if (!isCurrent()) throw new CancelledError({ silent: true })
      return page
    } catch (error) {
      if (!isCurrent()) throw new CancelledError({ silent: true })
      setCanonicalHead(null)
      notifyUnavailable(error)
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      pageReadControllersRef.current.delete(controller)
    }
  }, [fetchPage, notifyUnavailable, queryEnabled, queryFingerprint])

  const scheduleHistoricalWake = useCallback((delayMs: number) => {
    if (historyTimerRef.current !== null) return
    const generation = requestGenerationRef.current
    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null
      if (currentFingerprintRef.current !== queryFingerprint || generation !== requestGenerationRef.current
        || unavailableFingerprintRef.current === queryFingerprint) return
      window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT, {
        detail: { scope, conversationIds: [conversationId] },
      }))
    }, Math.max(0, delayMs))
  }, [conversationId, queryFingerprint, scope])

  const refreshLoadedHistory = useCallback((latestPage: PaginatedMessagesResult) => {
    const query = currentQuery()
    if (!query) return
    const cached = queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)
    if (!cached || cached.pages.length <= 1 || !latestPage.nextCursor) return
    if (historyRefreshRef.current) { historyTrailingRef.current = true; return }
    const clock = historyRefreshClockRef.current
    if (clock.fingerprint !== queryFingerprint) {
      clock.fingerprint = queryFingerprint
      clock.lastStartedAt = 0
    }
    const remainingGap = WHATSAPP_HISTORY_REFRESH_MIN_GAP_MS - (Date.now() - clock.lastStartedAt)
    if (remainingGap > 0) { scheduleHistoricalWake(remainingGap); return }
    if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = null
    const oldest = flattenWhatsAppMessagePages(cached.pages).find((message) => message.id !== message.client_message_id)
    if (!oldest) return
    const cycle: HistoricalMessageRefresh = {
      query,
      controller: new AbortController(), generation: requestGenerationRef.current,
      nextCursor: latestPage.nextCursor, remainingPages: cached.pages.length,
      oldestAliases: new Set([oldest.id, oldest.message_id, oldest.client_message_id].filter((id): id is string => Boolean(id))),
      seenCursors: new Set(), snapshotMessages: cached.pages.flatMap((page) => page.messages),
    }
    historyRefreshRef.current = cycle
    clock.lastStartedAt = Date.now()
    const isCurrent = () => !cycle.controller.signal.aborted && historyRefreshRef.current === cycle
      && currentFingerprintRef.current === queryFingerprint && cycle.generation === requestGenerationRef.current
      && currentQuery() === cycle.query
      && unavailableFingerprintRef.current !== queryFingerprint
    const finish = (error: unknown | null) => {
      if (!isCurrent()) return
      historyRefreshRef.current = null
      updateReconciliationFailure('history', error)
      if (historyTrailingRef.current) {
        historyTrailingRef.current = false
        scheduleHistoricalWake(WHATSAPP_HISTORY_REFRESH_MIN_GAP_MS - (Date.now() - clock.lastStartedAt))
      }
    }
    const runBatch = async () => {
      if (!isCurrent()) return
      const canRead = () => document.visibilityState === 'visible' && navigator.onLine !== false
        && queryClient.getQueryState(queryKey)?.fetchStatus !== 'fetching'
      if (!canRead()) {
        historyTimerRef.current = window.setTimeout(() => { historyTimerRef.current = null; void runBatch() }, WHATSAPP_HISTORY_REFRESH_BATCH_GAP_MS)
        return
      }
      try {
        for (let page = 0; page < WHATSAPP_HISTORY_REFRESH_BATCH_PAGES; page += 1) {
          if (!isCurrent()) return
          if (!canRead()) break
          const cursor = cycle.nextCursor
          if (!cursor || cycle.remainingPages <= 0 || cycle.seenCursors.has(cursor)) {
            finish(new Error('The loaded historical window could not be revalidated'))
            return
          }
          cycle.seenCursors.add(cursor)
          const canonical = await fetchPage(cursor, cycle.controller.signal)
          if (!isCurrent()) return
          queryClient.setQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey, (current) => current ? {
            ...current,
            pages: mergeWhatsAppHistoricalMessagePage(current.pages, canonical.messages, cycle.snapshotMessages),
          } : current)
          cycle.remainingPages -= 1
          cycle.nextCursor = canonical.nextCursor
          if (canonical.messages.some((message) => [message.id, message.message_id, message.client_message_id]
            .some((id) => Boolean(id && cycle.oldestAliases.has(id))))) {
            finish(null)
            return
          }
          if (!canonical.nextCursor) { finish(new Error('The loaded historical window changed')); return }
        }
        historyTimerRef.current = window.setTimeout(() => { historyTimerRef.current = null; void runBatch() }, WHATSAPP_HISTORY_REFRESH_BATCH_GAP_MS)
      } catch (error) {
        if (!isCurrent()) return
        if (isWhatsAppAccessUnavailable(error)) { notifyUnavailable(error); return }
        if (isWhatsAppMessageCursorRebaseRequired(error) && rebaseExpiredCursor()) return
        finish(error)
      }
    }
    void runBatch()
  }, [currentQuery, fetchPage, notifyUnavailable, queryClient, queryFingerprint, queryKey, rebaseExpiredCursor,
    scheduleHistoricalWake, updateReconciliationFailure])

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

    const activeQuery = currentQuery()
    if (!activeQuery) return
    if (![...headReadState(queryClient, activeQuery).owners.values()].some((owner) => owner.available())) return
    let request = pendingHeadRequest()
    if (!request) {
      const read = startHeadRead(queryClient, activeQuery)
      request = { read, promise: fetchPage(null, read.controller?.signal) }
      request.read.state.pending = request
      const startedRequest = request
      const releaseRequest = () => {
        if (startedRequest.read.state.pending === startedRequest) startedRequest.read.state.pending = undefined
      }
      void request.promise.then(
        releaseRequest,
        releaseRequest,
      )
    }
    const canonicalReadToken = request.read
    const isSharedCurrent = () => isCurrentHeadRead(canonicalReadToken)
      && [...canonicalReadToken.state.owners.values()].some((owner) => owner.available())
    let ownsProcessing = false

    try {
      const latestPage = await request.promise
      if (!isSharedCurrent() || request.handled) return
      request.handled = true
      ownsProcessing = true
      const cachedBeforeRefresh = queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)
      if (
        cachedBeforeRefresh?.pages[0]
        && shouldRebaseWhatsAppMessagePages(
          cachedBeforeRefresh.pages[0].messages,
          latestPage.messages,
        )
      ) {
        if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') return
        for (const { owner, generation } of snapshotHeadOwners(canonicalReadToken.state)) owner.onRefreshState('rebase', generation)
        const rebase = queryClient.refetchQueries(
          { queryKey, exact: true, type: 'active' },
          { cancelRefetch: false },
        )
        const rebaseFetch = activeQuery.promise
        await rebase

        const rebased = queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)
        const rebaseRead = canonicalReadToken.state.current
        if (!isCurrentHeadRead(rebaseRead) || rebaseRead.state.owners.size === 0
          || !rebaseFetch || rebaseRead.queryFetch !== rebaseFetch) return
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
        for (const { owner, generation } of snapshotHeadOwners(rebaseRead.state)) owner.onRefreshState('history-complete', generation)
        return
      }

      for (const { owner, generation } of snapshotHeadOwners(canonicalReadToken.state)) owner.onPage(latestPage, canonicalReadToken, generation, true)
      queryClient.setQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey, (cached) => {
        if (!cached?.pages.length || !isCurrentHeadRead(canonicalReadToken)) return cached
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
      if (isSharedCurrent()) {
        const recipient = snapshotHeadOwners(canonicalReadToken.state).find(({ owner }) => owner.available())
        recipient?.owner.onHistory(latestPage, recipient.generation)
      }
    } catch (error) {
      if (!isSharedCurrent() || (request.handled && !ownsProcessing)) return
      request.handled = true
      for (const { owner, generation } of snapshotHeadOwners(canonicalReadToken.state)) owner.onError(error, null, generation, true)
      // Transient polling failures preserve data. An authorization failure
      // closes the selection and removes its scoped history immediately.
    }
	}, [conversationId, currentQuery, fetchPage, isCurrentHeadRead, pageSize, pendingHeadRequest, queryClient, queryEnabled, queryFingerprint, queryKey])

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }): Promise<PaginatedMessagesResult> => {
      if (!conversationId) {
        return { messages: [], nextCursor: null }
      }

      const activeQuery = currentQuery()
      if (!activeQuery) throw new CancelledError({ silent: true })
      const canonicalReadToken = pageParam === null ? startHeadRead(queryClient, activeQuery, true) : null
      const sharedState = headReadState(queryClient, activeQuery)
      const fetchPromise = activeQuery.promise
      const startedHead = sharedState.current
      const isSharedReadCurrent = () => !signal.aborted && currentQuery() === activeQuery
        && activeQuery.promise === fetchPromise && sharedState.owners.size > 0
        && sharedState.current === startedHead
      let page: PaginatedMessagesResult
      try {
        page = await fetchPage(pageParam, signal)
      } catch (error) {
        if (!isSharedReadCurrent()) throw new CancelledError({ silent: true })
        // Snapshot all live recipients before the first denial retires the
        // shared ticket. Each callback still validates its own UI lifetime.
        const owners = snapshotHeadOwners(sharedState)
        let rebased = false
        for (const { owner, generation } of owners) if (owner.onError(error, pageParam, generation)) rebased = true
        if (rebased) throw new CancelledError({ silent: true })
        throw error
      }
      if (!isSharedReadCurrent()) throw new CancelledError({ silent: true })
      // An explicit canonical refetch can restore access after a new grant.
      // A late best-effort poll cannot repopulate a revoked cache.
      const owners = snapshotHeadOwners(sharedState)
      for (const { owner, generation } of owners) owner.onPage(page, canonicalReadToken, generation)
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
    enabled: queryEnabled && unavailableFingerprint !== queryFingerprint,
    staleTime: 5 * 60 * 1000,
    // Infinite-query refetches walk every loaded cursor page. Recent-message
    // reconciliation is handled below so loading history never disables the
    // safety poll. Loaded history is separately revalidated in bounded batches.
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (failureCount, error) => !isWhatsAppAccessUnavailable(error)
      && !isWhatsAppMessageCursorRebaseRequired(error) && failureCount < 3,
  })
  const observedQuery = currentQuery()
  useLayoutEffect(() => {
    if (!observedQuery) return
    const state = headReadState(queryClient, observedQuery)
    const isCurrentOwner = (generation: number) => currentFingerprintRef.current === queryFingerprint
      && requestGenerationRef.current === generation && headOwnerRef.current?.query === observedQuery
      && state.owners.get(canonicalPreviewOwner) === callbacks
    const callbacks: HeadReadOwner = {
      generation: () => requestGenerationRef.current,
      available: () => isCurrentOwner(requestGenerationRef.current) && unavailableFingerprintRef.current !== queryFingerprint,
      onPage: (page, read, generation, custom) => {
        if (!isCurrentOwner(generation) || (custom && !callbacks.available())) return
        unavailableFingerprintRef.current = null
        setUnavailableFingerprint(null)
        updateReconciliationFailure('head', null)
        if (read) captureRawHead(page, generation, read)
        else cursorRebasedIdentityRef.current = null
      },
      onError: (error, cursor, generation, custom) => {
        if (!isCurrentOwner(generation)) return false
        setCanonicalHead(null)
        if (cursor !== null && isWhatsAppMessageCursorRebaseRequired(error) && rebaseExpiredCursor()) return true
        if (custom && !isWhatsAppAccessUnavailable(error)) updateReconciliationFailure('head', error)
        else notifyUnavailable(error)
        return false
      },
      onRefreshState: (phase, generation) => {
        if (!isCurrentOwner(generation)) return
        if (phase === 'history-complete') updateReconciliationFailure('history', null)
        else { setCanonicalHead(null); abortHistoricalRefresh(); updateReconciliationFailure('head', null) }
      },
      onHistory: (page, generation) => { if (isCurrentOwner(generation)) refreshLoadedHistory(page) },
    }
    state.owners.set(canonicalPreviewOwner, callbacks)
    headOwnerRef.current = { query: observedQuery, state }
    return releaseHeadOwner
  }, [abortHistoricalRefresh, canonicalPreviewOwner, captureRawHead, notifyUnavailable, observedQuery, queryClient, queryFingerprint, rebaseExpiredCursor, refreshLoadedHistory, releaseHeadOwner, updateReconciliationFailure])
  useEffect(() => {
    if (query.isError) notifyUnavailable(query.error)
  }, [notifyUnavailable, query.error, query.isError])
  const refetchMessages = query.refetch
  const retryReconciliation = useCallback(async () => {
    if (currentFingerprintRef.current !== queryFingerprint) return
    abortHistoricalRefresh()
    historyRefreshClockRef.current.lastStartedAt = 0
    await refreshLatestPage(0)
  }, [abortHistoricalRefresh, queryFingerprint, refreshLatestPage])

  useEffect(() => {
    if (!queryEnabled || refreshedOnMountKeyRef.current === queryFingerprint) return
    refreshedOnMountKeyRef.current = queryFingerprint
    if (!queryClient.getQueryData<InfiniteData<PaginatedMessagesResult>>(queryKey)) return
    const generation = requestGenerationRef.current
    queueMicrotask(() => {
      if (currentFingerprintRef.current !== queryFingerprint || requestGenerationRef.current !== generation) return
      void refreshLatestPage(0)
    })
  }, [queryClient, queryEnabled, queryFingerprint, queryKey, refreshLatestPage])

  useEffect(() => {
    if (!queryEnabled) return

    let cancelled = false
    let pendingGeneration: number | null = null
    let trailingTimer: number | null = null
    let waitingHeadRequest: Promise<PaginatedMessagesResult> | null = null
    const canRefresh = () => document.visibilityState === 'visible' && navigator.onLine !== false
    const clearPending = () => {
      pendingGeneration = null
      if (trailingTimer !== null) window.clearTimeout(trailingTimer)
      trailingTimer = null
    }
    const flushPending = () => {
      if (cancelled || pendingGeneration === null) return
      if (currentFingerprintRef.current !== queryFingerprint
        || pendingGeneration !== requestGenerationRef.current
        || unavailableFingerprintRef.current === queryFingerprint) {
        clearPending()
        return
      }
      if (!canRefresh()) return
      if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') return
      const headRequest = pendingHeadRequest()?.promise
      if (headRequest) {
        if (waitingHeadRequest !== headRequest) {
          waitingHeadRequest = headRequest
          const settled = () => {
            if (waitingHeadRequest === headRequest) waitingHeadRequest = null
            flushPending()
          }
          void headRequest.then(settled, settled)
        }
        return
      }
      const refreshState = refreshStateRef.current
      const remainingGap = refreshState.key === queryFingerprint
        ? WHATSAPP_HEAD_REFRESH_MIN_GAP_MS - (Date.now() - refreshState.lastStartedAt)
        : 0
      if (remainingGap > 0) {
        if (trailingTimer === null) {
          trailingTimer = window.setTimeout(() => {
            trailingTimer = null
            flushPending()
          }, remainingGap)
        }
        return
      }
      if (trailingTimer !== null) window.clearTimeout(trailingTimer)
      trailingTimer = null
      const completion = refreshLatestPage(0)
      // A wake received during a GET may describe a newer commit than that
      // GET's snapshot. Consume it only once a fresh head request starts.
      if (pendingHeadRequest()) pendingGeneration = null
      void completion.then(flushPending, flushPending)
    }
    const reconcile = () => {
      if (cancelled || !canRefresh()) return
      pendingGeneration = requestGenerationRef.current
      flushPending()
    }
    const unsubscribeQueryCache = queryClient.getQueryCache().subscribe((event) => {
      if (pendingGeneration !== null && JSON.stringify(event.query.queryKey) === queryFingerprint
        && event.query.state.fetchStatus !== 'fetching') flushPending()
    })
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') reconcileVisibleHistory()
    }
    const reconcileVisibleHistory = () => {
      historyRefreshClockRef.current.lastStartedAt = 0
      reconcile()
    }
    const handleReconcileEvent = (event: Event) => {
      const detail = (event as CustomEvent<WhatsAppMessagesReconcileEventDetail>).detail
      if (detail?.scope && (detail.scope.organizationId !== scope.organizationId
        || detail.scope.userId !== scope.userId || detail.scope.accessScope !== scope.accessScope)) return
      if (detail?.conversationIds?.length && !detail.conversationIds.includes(conversationId!)) return
      if (detail?.leadIds?.length && !detail.leadIds.includes(historyLeadId || expectedLeadId || '')) return
      if (detail?.authorizationChanged) {
        // A lead transfer does not change the user's permission fingerprint.
        // Retire older reads and force a canonical authorization check even
        // when a previous denial disabled this observer.
        clearPending()
        setCanonicalHead(null)
        const requestGeneration = ++requestGenerationRef.current
        abortHistoricalRefresh()
        abortPageReads()
        retireHeadReads()
        void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
          if (currentFingerprintRef.current !== queryFingerprint
            || requestGenerationRef.current !== requestGeneration) return
          void refetchMessages()
        })
        return
      }
      reconcile()
    }

    window.addEventListener('focus', reconcileVisibleHistory)
    window.addEventListener('online', reconcileVisibleHistory)
    window.addEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, handleReconcileEvent)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const intervalMs = refreshInterval === false
      ? null
      : Math.max(refreshInterval, WHATSAPP_HEAD_REFRESH_MIN_GAP_MS)
    const interval = intervalMs
      ? window.setInterval(reconcile, intervalMs)
      : null

    return () => {
      cancelled = true
      clearPending()
      unsubscribeQueryCache()
      window.removeEventListener('focus', reconcileVisibleHistory)
      window.removeEventListener('online', reconcileVisibleHistory)
      window.removeEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, handleReconcileEvent)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [abortHistoricalRefresh, abortPageReads, conversationId, expectedLeadId, historyLeadId, queryClient, queryEnabled,
    pendingHeadRequest, queryFingerprint, queryKey, refetchMessages, refreshInterval, refreshLatestPage, retireHeadReads, scope])

  const allMessages = useMemo(
    () => unavailableFingerprint === queryFingerprint || isWhatsAppAccessUnavailable(query.error)
      ? [] : flattenWhatsAppMessagePages(query.data?.pages ?? []),
    [query.data?.pages, query.error, queryFingerprint, unavailableFingerprint],
  )

  const retryMediaDownload = useCallback(async () => {
    queryClient.invalidateQueries({
      queryKey,
    })
  }, [queryClient, queryKey])

  return {
    ...query,
    canonicalPreview: queryEnabled && !query.isError && unavailableFingerprint !== queryFingerprint
      && canonicalHead?.owner === canonicalPreviewOwner ? canonicalHead.preview : null,
    messages: allMessages,
    hasOlderMessages: query.hasNextPage,
    loadOlderMessages: query.fetchNextPage,
    isLoadingOlder: query.isFetchingNextPage,
    retryMediaDownload,
    readMessagePage,
    retryReconciliation,
    reconciliationError: reconciliationFailure?.fingerprint === queryFingerprint
      ? reconciliationFailure.head ?? reconciliationFailure.history : null,
    isReconciliationError: reconciliationFailure?.fingerprint === queryFingerprint
      && Boolean(reconciliationFailure.head ?? reconciliationFailure.history),
  }
}
