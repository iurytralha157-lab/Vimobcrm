'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { canMarkWhatsAppConversationRead, getWhatsAppCanonicalReadRows, getWhatsAppUnreadOwner,
  getWhatsAppUnreadSnapshot, type WhatsAppUnreadOptions } from '@/lib/whatsapp-unread';

type Options = WhatsAppUnreadOptions & { onRead: () => void | Promise<void> };

/** Local marker and visible-tail gating. The existing backend still clears a conversation count. */
export function useWhatsAppUnread(options: Options) {
  const [snapshot, setSnapshot] = useState(() => getWhatsAppUnreadSnapshot(null, options));
  const next = getWhatsAppUnreadSnapshot(snapshot, options);
  if (next.owner !== snapshot.owner || next.firstUnreadMessageId !== snapshot.firstUnreadMessageId
    || next.unreadCount !== snapshot.unreadCount || next.lastInboundId !== snapshot.lastInboundId) setSnapshot(next);
  const current = useRef(options), generation = useRef(0);
  const attempt = useRef<{ key: string; at: number } | null>(null);
  const owner = getWhatsAppUnreadOwner(options);
  useLayoutEffect(() => { current.current = options; });
  useLayoutEffect(() => {
    generation.current += 1; attempt.current = null;
    return () => { generation.current += 1; };
  }, [owner]);
  useEffect(() => {
    const epoch = generation.current;
    const read = () => {
      const value = current.current;
      if (generation.current !== epoch || getWhatsAppUnreadOwner(value) !== owner
        || !canMarkWhatsAppConversationRead(value, document.visibilityState === 'visible')) return;
      const lastId = getWhatsAppCanonicalReadRows(value).at(-1)?.id ?? null;
      const key = JSON.stringify([owner, lastId, value.lastMessageAt, value.unreadCount]);
      const now = Date.now();
      if (attempt.current?.key === key && now - attempt.current.at < 5_000) return;
      attempt.current = { key, at: now };
      // The mutation owns rollback/error feedback. Retry is bounded by focus
      // and fresh data; there is no polling or read-replay worker here.
      try { void Promise.resolve(value.onRead()).catch(() => {}); } catch { /* Keep the server counter authoritative. */ }
    };
    read();
    document.addEventListener('visibilitychange', read);
    window.addEventListener('focus', read);
    return () => {
      document.removeEventListener('visibilitychange', read);
      window.removeEventListener('focus', read);
    };
  }, [owner, options.atBottom, options.enabled, options.lastMessageAt, options.messages, options.unreadCount]);
  return { firstUnreadMessageId: next.firstUnreadMessageId, unreadCount: next.unreadCount };
}
