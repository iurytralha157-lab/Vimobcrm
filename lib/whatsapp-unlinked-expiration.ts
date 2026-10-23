import type { QueryClient } from '@tanstack/react-query'
import {
  matchesPaginatedWhatsAppMessagesQueryKey,
  matchesWhatsAppMessagesQueryKey,
  whatsappQueryKeys,
  type WhatsAppQueryScope,
} from '@/lib/whatsapp-query-cache'
import { WHATSAPP_UNLINKED_LEAD_SNAPSHOT } from '@/lib/whatsapp-message-input'

const UNLINKED_CONVERSATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

type UnlinkedConversationCandidate = {
  created_at?: string | null
  lead_id?: string | null
  lead?: { id?: string | null } | null
  is_group?: boolean | null
  historical_lead_view?: boolean | null
}

export function getWhatsAppUnlinkedExpiresAt(
  conversation: UnlinkedConversationCandidate | null | undefined,
): number | null {
  if (!conversation || conversation.is_group || conversation.historical_lead_view
    || conversation.lead_id || conversation.lead?.id) return null

  const createdAt = Date.parse(conversation.created_at ?? '')
  return Number.isFinite(createdAt) ? createdAt + UNLINKED_CONVERSATION_RETENTION_MS : null
}

export function isWhatsAppUnlinkedExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && now >= expiresAt
}

export function scheduleWhatsAppUnlinkedExpiration(
  expiresAt: number,
  onExpire: () => void,
): { check: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  let expired = false
  const check = () => {
    if (cancelled || expired) return
    if (isWhatsAppUnlinkedExpired(expiresAt, Date.now())) {
      expired = true
      onExpire()
      return
    }
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(check, Math.max(1, expiresAt - Date.now()))
  }
  timer = setTimeout(check, Math.max(0, expiresAt - Date.now()))
  return {
    check,
    cancel: () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    },
  }
}

export function isUnavailableWhatsAppConversationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  return status === 404 || status === 410
}

export function clearWhatsAppUnlinkedMessageCache(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  conversationId: string,
): void {
  queryClient.removeQueries({
    predicate: ({ queryKey }) =>
      matchesPaginatedWhatsAppMessagesQueryKey(
        queryKey, scope, conversationId, WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
      ) || matchesWhatsAppMessagesQueryKey(
        queryKey, scope, conversationId, WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
      ),
  })
}

export function refreshWhatsAppUnlinkedInbox(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
): void {
  void queryClient.invalidateQueries({
    queryKey: whatsappQueryKeys.conversationsScope(scope),
    refetchType: 'active',
  })
}
