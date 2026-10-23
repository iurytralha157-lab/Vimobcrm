'use client'
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getWhatsAppLocalSendPreviewStore } from '@/lib/whatsapp-local-send-preview'
import { WHATSAPP_MESSAGES_RECONCILE_EVENT, type WhatsAppQueryScope, type WhatsAppMessagesReconcileEventDetail } from '@/lib/whatsapp-query-cache'
import type { WhatsAppConversation } from '@/hooks/use-whatsapp-conversations'

export function useWhatsAppLocalSendPreviews<T extends WhatsAppConversation>(conversations: T[], scope: WhatsAppQueryScope) {
  const client = useQueryClient(), store = getWhatsAppLocalSendPreviewStore(client)
  const version = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  useLayoutEffect(() => { store.synchronizeScope(scope); store.reconcile(conversations, scope) }, [conversations, scope, store, version])
  useEffect(() => {
    const expiry = store.nextExpiry(scope)
    if (!Number.isFinite(expiry)) return
    const timer = setTimeout(() => store.expire(), Math.max(0, expiry - Date.now()))
    return () => clearTimeout(timer)
  }, [scope, store, version])
  useLayoutEffect(() => {
    const hint = (event: Event) => {
      const detail = (event as CustomEvent<WhatsAppMessagesReconcileEventDetail>).detail
      if (!detail?.authorizationChanged || (detail.scope && (detail.scope.organizationId !== scope.organizationId
        || detail.scope.userId !== scope.userId || detail.scope.accessScope !== scope.accessScope))) return
      store.clear(scope, detail.conversationIds, detail.leadIds)
    }
    window.addEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, hint)
    return () => window.removeEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, hint)
  }, [scope, store])
  return store.project(conversations, scope)
}
