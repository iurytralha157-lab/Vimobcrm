import type { QueryClient } from '@tanstack/react-query'
import {
  matchesPaginatedWhatsAppMessagesQueryKey,
  matchesWhatsAppMessagesQueryKey,
  matchesLeadMessagesQueryKey,
  matchesWhatsAppAttendanceQueryKey,
  isWhatsAppQueryKeyForScope,
  type WhatsAppQueryScope,
} from '@/lib/whatsapp-query-cache'

export function isWhatsAppAccessUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  const code = (error as { code?: unknown }).code
  // The API transport has already exhausted its token refresh before exposing 401.
  return status === 401 || status === 403 || status === 404 || status === 410
    || (status === 400 && code === 'invalid_whatsapp_reference')
}

export function clearUnavailableWhatsAppLeadCache(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  leadId: string,
): void {
  const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (!isWhatsAppQueryKeyForScope(queryKey, scope)) return false
    if (matchesLeadMessagesQueryKey(queryKey, scope, leadId)
      || matchesWhatsAppMessagesQueryKey(queryKey, scope, null, leadId)
      || matchesWhatsAppAttendanceQueryKey(queryKey, scope, [], [leadId])) return true
    if (queryKey[0] === 'whatsapp-messages-paginated') {
      return queryKey[7] === leadId || queryKey.includes(`lead-history:${leadId}`)
    }
    if (['whatsapp-conversation', 'whatsapp-conversation-history'].includes(String(queryKey[0]))) {
      return queryKey[6] === leadId
    }
    if (queryKey[0] === 'whatsapp-conversation-snapshot') {
      const snapshot = queryClient.getQueryData<{ lead_id?: string | null; lead?: { id?: string } | null }>(queryKey)
      return snapshot?.lead_id === leadId || snapshot?.lead?.id === leadId
    }
    return false
  }
  void queryClient.cancelQueries({ predicate })
  queryClient.removeQueries({ predicate })
}

export function clearUnavailableWhatsAppMessageCache(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  conversationId: string,
  leadId?: string | null,
): void {
  const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) =>
    matchesPaginatedWhatsAppMessagesQueryKey(queryKey, scope, conversationId)
    || matchesWhatsAppMessagesQueryKey(queryKey, scope, conversationId)
    || (!!leadId && leadId !== 'unlinked' && matchesLeadMessagesQueryKey(queryKey, scope, leadId))
    || matchesWhatsAppAttendanceQueryKey(queryKey, scope, [conversationId], leadId ? [leadId] : [])
    || (isWhatsAppQueryKeyForScope(queryKey, scope)
      && ['whatsapp-conversation', 'whatsapp-conversation-snapshot', 'whatsapp-conversation-history'].includes(String(queryKey[0]))
      && (queryKey[5] === conversationId || (queryKey[5] === 'lead' && queryKey[6] === leadId)))

  // Cancel tracked requests before removing only this tenant/user's data.
  // The open-chat caller closes its selection; other conversations remain.
  void queryClient.cancelQueries({ predicate })
  queryClient.removeQueries({ predicate })
}
