'use client';
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getWhatsAppConversationDraftKey } from '@/lib/whatsapp-message-input';
import { getWhatsAppDraftOwner, getWhatsAppDraftStore } from '@/lib/whatsapp-draft-store';
import type { WhatsAppQueryScope } from '@/lib/whatsapp-query-cache';

/** Shared by page, floating chat and lead; session storage retains text on reload in this tab. */
export function useWhatsAppConversationDraft(scope: WhatsAppQueryScope, conversationId: string | null, expectedLeadId: string | null) {
  const owner = getWhatsAppDraftOwner({ ...scope, accessScope: scope.draftAccessScope ?? scope.accessScope });
  const key = getWhatsAppConversationDraftKey({ tenantKey: owner, conversationId, expectedLeadId });
  const store = getWhatsAppDraftStore();
  // Stored text belongs to the actor/organization/permissions. Live callbacks
  // additionally belong to the current SID, even when its draft key is stable.
  const ownerToken = useMemo(() => ({ owner, accessScope: scope.accessScope }), [owner, scope.accessScope]);
  const keyToken = useMemo(() => ({ key, accessScope: scope.accessScope }), [key, scope.accessScope]);
  const currentOwner = useRef<typeof ownerToken | null>(ownerToken);
  const ownerRef = useRef(owner);
  useLayoutEffect(() => {
    currentOwner.current = ownerToken;
    if (ownerRef.current && ownerRef.current !== owner) store.clearOwner(ownerRef.current);
    // Auth may be unresolved on the first reload render. Keep drafts until the actual owner is known.
    if (owner) store.retainOwner(owner);
    ownerRef.current = owner;
    return () => { currentOwner.current = null; };
  }, [owner, ownerToken, store]);
  const getSnapshot = useCallback(() => store.get(key), [key, store]);
  const text = useSyncExternalStore(store.subscribe, getSnapshot, () => '');
  // Inbox rows also read drafts for other conversations. Their current key can
  // be empty, so subscribing only to its text would suppress those updates.
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  const current = useRef<typeof keyToken | null>(keyToken);
  useLayoutEffect(() => { current.current = keyToken; return () => { current.current = null; }; }, [keyToken]);
  const setText = useCallback((value: string | ((text: string) => string)) => {
    if (current.current === keyToken) store.set(key, value);
  }, [key, keyToken, store]);
  const clearConversation = useCallback((id: string) => { if (owner && currentOwner.current === ownerToken) store.clearConversation(owner, id); }, [owner, ownerToken, store]);
  const getConversationDraft = useCallback((id: string, leadId: string | null) => currentOwner.current === ownerToken
    ? store.get(getWhatsAppConversationDraftKey({ tenantKey: owner, conversationId: id, expectedLeadId: leadId })) : '', [owner, ownerToken, store]);
  const setConversationDraft = useCallback((id: string, leadId: string, value: string | ((text: string) => string)) => {
    if (owner && currentOwner.current === ownerToken) store.set(getWhatsAppConversationDraftKey({ tenantKey: owner, conversationId: id, expectedLeadId: leadId }), value);
  }, [owner, ownerToken, store]);
  return { text, setText, clearConversation, getConversationDraft, setConversationDraft, key };
}
