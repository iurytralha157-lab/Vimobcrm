import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { VimobAPIError } from '@/lib/api/vimob-error'
import { isWhatsAppQueryKeyForScope, type WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'

const pendingArchives = new WeakMap<QueryClient, Set<string>>()

export function matchesWhatsAppArchiveQuery(key: QueryKey, scope: WhatsAppQueryScope, conversationId: string, leadId: string) {
  if (!isWhatsAppQueryKeyForScope(key, scope)) return false
  if (key[0] === 'whatsapp-conversations') return true
  if (key[0] === 'whatsapp-conversation-snapshot' || key[0] === 'whatsapp-conversation-history') return key[5] === conversationId
  return key[0] === 'whatsapp-conversation' && (key[5] === conversationId || (key[5] === 'lead' && key[6] === leadId))
}

export function isWhatsAppArchiveInvocation(value: unknown, scope: WhatsAppQueryScope, conversationId?: string) {
  if (!value || typeof value !== 'object') return false
  const invocation = value as { variables?: { conversation?: { id?: string }; archive?: unknown }; intent?: { scope?: WhatsAppQueryScope } }
  const owner = invocation.intent?.scope
  return Boolean(owner && owner.organizationId === scope.organizationId && owner.userId === scope.userId && owner.accessScope === scope.accessScope
    && typeof invocation.variables?.archive === 'boolean' && invocation.variables.conversation?.id
    && (!conversationId || invocation.variables.conversation.id === conversationId))
}

/** One physical conversation operation across widgets on the same QueryClient. */
export async function runExclusiveWhatsAppArchive<T>(client: QueryClient, scope: WhatsAppQueryScope, conversationId: string, request: () => Promise<T>): Promise<T> {
  let pending = pendingArchives.get(client)
  if (!pending) { pending = new Set(); pendingArchives.set(client, pending) }
  const key = JSON.stringify([scope.organizationId, scope.userId, scope.accessScope, conversationId])
  if (pending.has(key)) throw new VimobAPIError('Aguarde a conclusão do arquivamento desta conversa.', { code: 'whatsapp_archive_pending', status: 409 })
  pending.add(key)
  try { return await request() } finally { pending.delete(key) }
}
