export type WhatsAppMessageGrouping = 'single' | 'first' | 'middle' | 'last';

export type WhatsAppGroupingMessage = {
  id: string;
  sent_at: string;
  from_me: boolean;
  conversation_id?: string | null;
  session_id?: string | null;
  lead_id?: string | null;
  sender_jid?: string | null;
  sender_name?: string | null;
  sender_user_id?: string | null;
  message_type?: string | null;
};

const GROUP_INTERVAL_MS = 5 * 60_000;
const systemTypes = new Set(['reaction', 'system', 'attendance']);

function sameBlock(left: WhatsAppGroupingMessage | null | undefined, right: WhatsAppGroupingMessage | null | undefined) {
  if (!left || !right || left.id === right.id
    || systemTypes.has(left.message_type || '') || systemTypes.has(right.message_type || '')
    || left.from_me !== right.from_me
    || (left.conversation_id || null) !== (right.conversation_id || null)
    || (left.session_id || null) !== (right.session_id || null)
    || (left.lead_id || null) !== (right.lead_id || null)
    || (left.sender_user_id || null) !== (right.sender_user_id || null)
    || (left.sender_jid || left.sender_name || '') !== (right.sender_jid || right.sender_name || '')) return false;
  const first = new Date(left.sent_at), second = new Date(right.sent_at);
  const gap = second.getTime() - first.getTime();
  return Number.isFinite(gap) && gap >= 0 && gap <= GROUP_INTERVAL_MS
    && first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth() && first.getDate() === second.getDate();
}

/** Neighbours must be null at a day, attendance or other timeline boundary. */
export function getWhatsAppMessageGrouping(
  previous: WhatsAppGroupingMessage | null | undefined,
  current: WhatsAppGroupingMessage,
  next: WhatsAppGroupingMessage | null | undefined,
): WhatsAppMessageGrouping {
  const before = sameBlock(previous, current), after = sameBlock(current, next);
  return before ? (after ? 'middle' : 'last') : (after ? 'first' : 'single');
}

export const isWhatsAppMessageBlockStart = (grouping: WhatsAppMessageGrouping) => grouping === 'single' || grouping === 'first';
