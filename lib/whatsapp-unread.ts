import type { WhatsAppMessage } from '@/hooks/use-whatsapp-conversations';

export type WhatsAppUnreadOptions = {
  scopeKey: string;
  conversationId: string | null;
  unreadCount: number;
  lastMessageAt?: string | null;
  messages: readonly WhatsAppMessage[];
  enabled: boolean;
  atBottom: boolean;
};
export type WhatsAppUnreadSnapshot = {
  owner: string;
  firstUnreadMessageId: string | null;
  unreadCount: number;
  lastInboundId: string | null;
};
const CANONICAL_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const excludedTypes = new Set(['reaction', 'system', 'attendance']);
const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/** Keep PostgreSQL/provider microseconds; Date alone truncates freshness to milliseconds. */
function timeKey(value?: string | null) {
  const instant = Date.parse(value || '');
  if (!Number.isFinite(instant)) return null;
  const normalized = new Date(instant).toISOString();
  const fraction = value?.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1] ?? normalized.slice(20, 23);
  return `${normalized.slice(0, 19)}.${fraction.padEnd(6, '0').slice(0, 6)}Z`;
}
export function getWhatsAppUnreadOwner(options: WhatsAppUnreadOptions) {
  return JSON.stringify([options.scopeKey, options.conversationId, options.enabled]);
}
export function getWhatsAppCanonicalReadRows(options: WhatsAppUnreadOptions) {
  return options.messages.filter(message => message.conversation_id === options.conversationId
    && CANONICAL_ID.test(message.id) && !excludedTypes.has(message.message_type)
    && !message.metadata?.local_delivery_state && Boolean(timeKey(message.sent_at)));
}
export function getWhatsAppUnreadSnapshot(previous: WhatsAppUnreadSnapshot | null, options: WhatsAppUnreadOptions): WhatsAppUnreadSnapshot {
  const owner = getWhatsAppUnreadOwner(options), unreadCount = options.enabled ? count(options.unreadCount) : 0;
  const incoming = getWhatsAppCanonicalReadRows(options).filter(message => !message.from_me);
  const lastInboundId = incoming.at(-1)?.id ?? null;
  let firstUnreadMessageId = previous?.owner === owner ? previous.firstUnreadMessageId : null;
  if (unreadCount > 0 && (!firstUnreadMessageId || previous?.owner !== owner || previous.unreadCount === 0)) {
    // The server supplies a count, not a per-message watermark. This is the
    // first unread row within the loaded authorized slice, never an exact ledger.
    firstUnreadMessageId = incoming.at(-Math.min(unreadCount, incoming.length))?.id ?? null;
  }
  return { owner, firstUnreadMessageId, unreadCount, lastInboundId };
}
export function canMarkWhatsAppConversationRead(options: WhatsAppUnreadOptions, visible: boolean) {
  if (!options.enabled || !options.atBottom || !visible || !options.conversationId || count(options.unreadCount) === 0) return false;
  const bound = timeKey(options.lastMessageAt);
  const rows = getWhatsAppCanonicalReadRows(options);
  const latest = rows.reduce<string | null>((current, message) => {
    const next = timeKey(message.sent_at);
    return next && (!current || next > current) ? next : current;
  }, null);
  return Boolean(bound && latest && latest >= bound && rows.some(message => !message.from_me));
}
