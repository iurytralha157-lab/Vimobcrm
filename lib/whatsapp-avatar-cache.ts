import type { QueryClient, QueryKey } from '@tanstack/react-query'

const CONVERSATION_AVATAR_KEYS = new Set([
  'whatsapp-conversations',
  'whatsapp-conversation',
  'whatsapp-conversation-snapshot',
  'whatsapp-conversation-history',
])

export function isWhatsAppAvatarQuery(
  key: QueryKey,
  organizationId: string,
  userId?: string,
) {
  if (!organizationId.trim() || organizationId === 'none') return false

  if (key[0] === 'whatsapp-sender-avatars') {
    if (key[1] !== organizationId) return false
    const targetUserId = userId?.trim().toLowerCase()
    if (!targetUserId) return true
    const requestedIds = key[7]
    return typeof requestedIds === 'string'
      && requestedIds.split(',').some((id) => id.toLowerCase() === targetUserId)
  }

  if (key[0] === 'user-summaries' || key[0] === 'organization-users') return key[1] === organizationId

  return typeof key[0] === 'string'
    && CONVERSATION_AVATAR_KEYS.has(key[0])
    && key[1] === 'tenant-scope'
    && key[2] === organizationId
    && !(key[0] === 'whatsapp-conversations' && key[5] === 'unread-count')
}

/** Refreshes photo projections without clearing message, receipt or unread state. */
export async function invalidateWhatsAppAvatarCaches(
  queryClient: QueryClient,
  organizationId: string,
  userId?: string,
): Promise<void> {
  const predicate = (query: { queryKey: QueryKey }) =>
    isWhatsAppAvatarQuery(query.queryKey, organizationId, userId)

  // Retire an older in-flight photo response before starting an active refresh.
  await queryClient.cancelQueries({ predicate })
  await queryClient.invalidateQueries({ predicate, refetchType: 'active' })
}
