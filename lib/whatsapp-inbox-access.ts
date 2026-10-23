import { CancelledError, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { isWhatsAppQueryKeyForScope, type WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'

// An inbox denial retires every read already started by that exact client and
// authorization scope. A later canonical GET may establish access again.
const tickets = new WeakMap<QueryClient, Map<string, object>>()

export function isWhatsAppInboxAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  return status === 401 || status === 403
}

export async function readWhatsAppInbox<T>(
  client: QueryClient,
  scope: WhatsAppQueryScope,
  queryKey: QueryKey,
  signal: AbortSignal,
  read: () => Promise<T>,
): Promise<T> {
  let scopes = tickets.get(client)
  if (!scopes) { scopes = new Map(); tickets.set(client, scopes) }
  const scopeTickets = scopes
  const scopeKey = JSON.stringify([scope.organizationId, scope.userId, scope.accessScope])
  let ticket = scopes.get(scopeKey)
  if (!ticket) { ticket = {}; scopes.set(scopeKey, ticket) }
  const query = client.getQueryCache().find({ queryKey, exact: true })
  const current = () => !signal.aborted && scopeTickets.get(scopeKey) === ticket
    && query !== undefined && client.getQueryCache().find({ queryKey, exact: true }) === query
  if (!current()) throw new CancelledError({ silent: true })

  try {
    const data = await read()
    if (!current()) throw new CancelledError({ silent: true })
    return data
  } catch (error) {
    if (!current()) throw new CancelledError({ silent: true })
    if (isWhatsAppInboxAccessDenied(error)) {
      scopeTickets.set(scopeKey, {})
      const matchesInbox = (entry: { queryKey: QueryKey }) => entry.queryKey[0] === 'whatsapp-conversations'
        && isWhatsAppQueryKeyForScope(entry.queryKey, scope)
      // Cancellation reverts synchronously. Empty the cache afterwards, so a
      // cancelled sibling cannot restore its former private snapshot.
      void client.cancelQueries({ predicate: entry => entry !== query && matchesInbox(entry) })
      client.setQueriesData({ predicate: matchesInbox }, (previous: unknown) => {
        if (typeof previous === 'number') return 0
        if (!previous || typeof previous !== 'object' || !('pages' in previous)) return previous
        return { ...previous, pages: [], pageParams: [] }
      })
      // Reopening a cached filter/list must recheck access rather than treating
      // the emptied snapshot as fresh. Do not start another GET on this denial.
      void client.invalidateQueries({ predicate: matchesInbox, refetchType: 'none' })
    }
    throw error
  }
}
