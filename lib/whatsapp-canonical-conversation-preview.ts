import type { WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'
import { WHATSAPP_UNLINKED_LEAD_SNAPSHOT } from '@/lib/whatsapp-message-input'

export interface WhatsAppCanonicalPreviewContext {
  scope: WhatsAppQueryScope
  conversationId: string | null
  expectedLeadId: string | null
  expectedSessionId: string | null
  historyLeadId?: string | null
}

export interface WhatsAppCanonicalConversationPreview {
  scope: WhatsAppQueryScope
  conversationId: string
  expectedLeadId: string
  sessionId: string
  messageId: string
  preview: string
  fromMe: boolean
  status: string
  sentAt: string
}

type PreviewConversation = {
  id: string
  session_id: string | null
  lead_id: string | null
  lead?: { id: string } | null
  last_message_at: string | null
  last_message_from_me?: boolean | null
  last_message_status?: string | null
  historical_lead_view?: boolean
  supervisory_lead_view?: boolean
  platform?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RECEIPTS = new Set(['queued', 'pending', 'sending', 'confirming', 'unconfirmed',
  'sent', 'delivered', 'read', 'played', 'received', 'failed', 'error'])
const LOCAL_RECEIPTS = new Set(['queued', 'pending', 'sending', 'confirming', 'unconfirmed', 'failed', 'error'])
const MEDIA_PREVIEWS: Record<string, string> = {
  image: '[Imagem]', video: '[Video]', audio: '[Audio]', document: '[Documento]', sticker: '[Figurinha]',
}
const uuid = (value: unknown) => typeof value === 'string' && UUID.test(value.trim())
  && value.trim() !== '00000000-0000-0000-0000-000000000000' ? value.trim().toLowerCase() : null
const record = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value)
const leadSnapshot = (value: unknown) => value === WHATSAPP_UNLINKED_LEAD_SNAPSHOT ? value : uuid(value)

// Timestamps only fence freshness. They never join a status to a preview.
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/)
  if (!parts) return null
  const [, year, month, day, hour, minute, second, fraction] = parts
  const monthEnd = new Date(0)
  monthEnd.setUTCFullYear(Number(year), Number(month), 0)
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > monthEnd.getUTCDate()
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) return null
  return `${new Date(instant).toISOString().slice(0, 19)}.${(fraction || '').padEnd(9, '0')}Z`
}

/** Only call with an authorized raw, cursor-null current-conversation page. */
export function captureWhatsAppCanonicalConversationPreview(
  rawMessages: readonly unknown[], context: WhatsAppCanonicalPreviewContext,
): WhatsAppCanonicalConversationPreview | null {
  const conversationId = uuid(context.conversationId), sessionId = uuid(context.expectedSessionId)
  const expectedLeadId = leadSnapshot(context.expectedLeadId)
  if (context.historyLeadId || !context.scope.organizationId || !context.scope.userId
    || !context.scope.accessScope || !conversationId || !sessionId || !expectedLeadId || !rawMessages.length) return null
  if (rawMessages.some(message => !record(message) || uuid(message.conversation_id) !== conversationId
    || uuid(message.session_id) !== sessionId
    || (message.organization_id !== undefined && message.organization_id !== context.scope.organizationId)
    || (message.lead_id !== undefined && (message.lead_id === null
      ? expectedLeadId !== WHATSAPP_UNLINKED_LEAD_SNAPSHOT : uuid(message.lead_id) !== expectedLeadId)))) return null

  // The wire page is chronological. Skip only explicit reactions, as the list
  // projection does; never skip an invalid head and substitute an older row.
  const head = [...rawMessages].reverse().find(message => record(message)
    && message.message_type !== 'reaction' && message.reaction_to_message_id == null)
  if (!record(head)) return null
  const messageId = uuid(head.id)
  if (!messageId || typeof head.from_me !== 'boolean' || typeof head.status !== 'string'
    || !RECEIPTS.has(head.status) || typeof head.message_type !== 'string' || !head.message_type
    || (head.content !== null && typeof head.content !== 'string') || !timestamp(head.sent_at)
    || head.capture_state === 'suppressed'
    || (LOCAL_RECEIPTS.has(head.status) && (messageId === uuid(head.client_message_id)
      || (messageId === uuid(head.message_id) && (!head.client_message_id || uuid(head.client_message_id) === messageId))))
    || (record(head.metadata) && (head.metadata.local_delivery_state !== undefined
      || head.metadata.capture_state === 'suppressed'))) return null
  return { scope: { ...context.scope }, conversationId, expectedLeadId, sessionId, messageId,
    preview: head.content || MEDIA_PREVIEWS[head.message_type] || '[Mensagem]',
    fromMe: head.from_me, status: head.status, sentAt: head.sent_at as string }
}

/** Replace the complete tuple only for its authorized route and current binding. */
export function projectWhatsAppCanonicalConversationPreview<T extends PreviewConversation>(
  conversations: T[], preview: WhatsAppCanonicalConversationPreview | null | undefined,
  scope: WhatsAppQueryScope,
): T[] {
  if (!preview || preview.scope.organizationId !== scope.organizationId || preview.scope.userId !== scope.userId
    || preview.scope.accessScope !== scope.accessScope) return conversations
  const headAt = timestamp(preview.sentAt)
  if (!headAt) return conversations
  let changed = false
  const projected = conversations.map(conversation => {
    // A published canonical DTO, including authoritative nulls, always wins.
    if (Object.hasOwn(conversation, 'last_message_from_me') || Object.hasOwn(conversation, 'last_message_status')
      || conversation.platform || conversation.historical_lead_view || conversation.supervisory_lead_view
      || (conversation.lead_id && conversation.lead?.id
        && uuid(conversation.lead_id) !== uuid(conversation.lead.id))
      || uuid(conversation.id) !== preview.conversationId || uuid(conversation.session_id) !== preview.sessionId
      || (uuid(conversation.lead_id || conversation.lead?.id) || WHATSAPP_UNLINKED_LEAD_SNAPSHOT) !== preview.expectedLeadId) return conversation
    const listAt = timestamp(conversation.last_message_at)
    if (!listAt || listAt > headAt) return conversation
    changed = true
    return { ...conversation, last_message: preview.preview, last_message_from_me: preview.fromMe,
      last_message_status: preview.status, last_message_id: preview.messageId, last_message_sent_at: preview.sentAt }
  })
  return changed ? projected : conversations
}
