import { isCancelledError, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query'

type PendingRefresh = { pending: boolean; retired: boolean }
type RefreshOwner = { pending: Map<Query, PendingRefresh>; unsubscribe?: () => void }

const owners = new WeakMap<QueryClient, RefreshOwner>()

function isTerminalError(error: unknown) {
  if (isCancelledError(error)) return true
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  return [401, 403, 404].includes(Number(error.status))
}

/**
 * A wake is not a reason to restart an already authorized canonical read. Let
 * it publish, then consume at most one pending wake with a fresh read. State is
 * shared by the actual Query instance, never just by its reusable key/hash.
 */
export function refreshWhatsAppQueries(client: QueryClient, queryKey: QueryKey) {
  const cache = client.getQueryCache()
  let owner = owners.get(client)
  if (!owner) {
    owner = { pending: new Map() }
    owners.set(client, owner)
  }
  const currentOwner = owner
  const retire = (query: Query, state: PendingRefresh) => {
    state.retired = true
    if (currentOwner.pending.get(query) === state) currentOwner.pending.delete(query)
    if (!currentOwner.pending.size) {
      currentOwner.unsubscribe?.()
      currentOwner.unsubscribe = undefined
    }
  }
  const isCurrent = (query: Query, state: PendingRefresh) => !state.retired
    && cache.get(query.queryHash) === query && query.isActive()
    && !query.isDisabled() && !query.isStatic()

  for (const query of cache.findAll({ queryKey })) {
    query.invalidate()
    if (!query.isActive() || query.isDisabled() || query.isStatic()) continue
    const existing = currentOwner.pending.get(query)
    if (existing) {
      existing.pending = true
      continue
    }
    const state = { pending: true, retired: false }
    currentOwner.pending.set(query, state)
    if (!currentOwner.unsubscribe) {
      currentOwner.unsubscribe = cache.subscribe(event => {
        const pending = currentOwner.pending.get(event.query)
        if (!pending) return
        if (event.type === 'removed' || (['observerRemoved', 'observerOptionsUpdated'].includes(event.type)
          && !event.query.isActive())) {
          retire(event.query, pending)
          // Removing the last observer normally cancels a signal-consuming
          // query itself. Disabling its remaining observers needs this too.
          if (event.type !== 'removed') void event.query.cancel({ revert: true })
        }
      })
    }
    void (async () => {
      try {
        // This may be an initial read, next-page gesture or window-focus read.
        // Its snapshot predates this wake, so it cannot consume the pending bit.
        let read = query.state.fetchStatus !== 'idle' ? query.promise : undefined
        while (isCurrent(query, state) && (read || state.pending)) {
          if (!read) {
            state.pending = false
            const fetch = query.fetch(undefined, { cancelRefetch: false })
            // Query.fetch can resolve reverted cached data after cancellation.
            // The retryer's public promise retains that cancellation signal.
            void fetch.catch(() => undefined)
            read = query.promise ?? fetch
          }
          try { await read } catch (error) {
            if (isTerminalError(error)) break
            // Only a real wake permits another attempt; failure alone never loops.
          }
          read = undefined
        }
      } finally {
        retire(query, state)
      }
    })()
  }
}
