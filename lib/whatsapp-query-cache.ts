import type { QueryKey } from '@tanstack/react-query'

const WHATSAPP_SCOPE_MARKER = 'tenant-scope' as const
const MISSING_SCOPE_VALUE = 'none' as const

export type WhatsAppQueryScope = {
  organizationId: string | null
  userId: string | null
  accessScope: string
}

export type WhatsAppAccessContext = {
  memberRole?: string | null
  permissions?: readonly string[] | null
  isTeamLeader?: boolean | null
  ledTeamIds?: readonly string[] | null
  ledUserIds?: readonly string[] | null
  ledPipelineIds?: readonly string[] | null
  isSuperAdmin?: boolean | null
}

export type WhatsAppConversationSessionFilter = {
  sessionId?: string
  accessibleSessionIds?: string[]
}

export const whatsappInboxTopic = (organizationId: string) =>
  `whatsapp:${organizationId}:inbox`

export function isWhatsAppInboxWakePayload(payload: unknown): payload is { scope: 'conversations' } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  return Object.keys(record).length === 1 && record.scope === 'conversations'
}

/**
 * "All" is lead-scoped by the backend, not session-scoped by the browser.
 * An explicit session remains fail-closed unless it belongs to the current
 * user's session list.
 */
export function resolveWhatsAppConversationSessionFilter(
  selectedSessionId: string,
  ownedSessionIds: readonly string[],
): WhatsAppConversationSessionFilter {
  if (!selectedSessionId || selectedSessionId === 'all') return {}
  if (!ownedSessionIds.includes(selectedSessionId)) {
    return { accessibleSessionIds: [] }
  }
  return { sessionId: selectedSessionId }
}

const scopedPrefix = (root: string, scope: WhatsAppQueryScope) => [
  root,
  WHATSAPP_SCOPE_MARKER,
  scope.organizationId ?? MISSING_SCOPE_VALUE,
  scope.userId ?? MISSING_SCOPE_VALUE,
  scope.accessScope,
] as const

const stableList = (values?: readonly string[] | null) =>
  [...(values ?? [])].sort().join(',')

export function createWhatsAppAccessScope(context: WhatsAppAccessContext): string {
  return [
    `member:${context.memberRole ?? MISSING_SCOPE_VALUE}`,
    `permissions:${stableList(context.permissions)}`,
    `team-leader:${context.isTeamLeader ? 'yes' : 'no'}`,
    `teams:${stableList(context.ledTeamIds)}`,
    `users:${stableList(context.ledUserIds)}`,
    `pipelines:${stableList(context.ledPipelineIds)}`,
    `super-admin:${context.isSuperAdmin ? 'yes' : 'no'}`,
  ].join('|')
}

export const whatsappQueryKeys = {
  sessionsScope: (scope: WhatsAppQueryScope) =>
    scopedPrefix('whatsapp-sessions', scope),
  sessions: (scope: WhatsAppQueryScope) =>
    scopedPrefix('whatsapp-sessions', scope),
  session: (scope: WhatsAppQueryScope, sessionId: string | null) => [
    ...scopedPrefix('whatsapp-session', scope),
    sessionId,
  ] as const,
  sessionAccess: (scope: WhatsAppQueryScope, sessionId: string | null) => [
    ...scopedPrefix('whatsapp-session-access', scope),
    sessionId,
  ] as const,
  accessibleSessions: (scope: WhatsAppQueryScope) =>
    scopedPrefix('accessible-sessions', scope),
  conversationsScope: (scope: WhatsAppQueryScope) =>
    scopedPrefix('whatsapp-conversations', scope),
  conversations: (
    scope: WhatsAppQueryScope,
    params: {
      sessionId?: string
      hideGroups: boolean
      showArchived: boolean
      onlyLeads: boolean
      withoutLead: boolean
      pendingReply: boolean
      search?: string
      accessibleSessionKey: string
      limit: number
    },
  ) => [
    ...scopedPrefix('whatsapp-conversations', scope),
    params.sessionId ?? 'all',
    params.hideGroups,
    params.showArchived,
    params.onlyLeads,
    params.withoutLead,
    params.pendingReply,
    params.search ?? '',
    params.accessibleSessionKey,
    params.limit,
  ] as const,
  conversation: (scope: WhatsAppQueryScope, conversationId: string | null) => [
    ...scopedPrefix('whatsapp-conversation', scope),
    conversationId,
  ] as const,
  conversationForLead: (scope: WhatsAppQueryScope, leadId: string | null) => [
    ...scopedPrefix('whatsapp-conversation', scope),
    'lead',
    leadId,
  ] as const,
  messagesScope: (scope: WhatsAppQueryScope) =>
    scopedPrefix('whatsapp-messages', scope),
  messagesForConversation: (scope: WhatsAppQueryScope, conversationId: string) => [
    ...scopedPrefix('whatsapp-messages', scope),
    conversationId,
  ] as const,
  messages: (
    scope: WhatsAppQueryScope,
    params: {
      conversationId: string | null
      leadId: string | null
      limit: number
      includeLeadHistory: boolean
    },
  ) => [
    ...scopedPrefix('whatsapp-messages', scope),
    params.conversationId,
    params.leadId,
    params.limit,
    params.includeLeadHistory ? 'lead-history' : 'conversation-page',
  ] as const,
  paginatedMessagesScope: (scope: WhatsAppQueryScope) =>
    scopedPrefix('whatsapp-messages-paginated', scope),
  paginatedMessagesForConversation: (
    scope: WhatsAppQueryScope,
    conversationId: string,
  ) => [
    ...scopedPrefix('whatsapp-messages-paginated', scope),
    conversationId,
  ] as const,
  paginatedMessages: (
    scope: WhatsAppQueryScope,
    conversationId: string | null,
    pageSize: number,
  ) => [
    ...scopedPrefix('whatsapp-messages-paginated', scope),
    conversationId,
    pageSize,
  ] as const,
  leadMessagesScope: (scope: WhatsAppQueryScope, leadId?: string | null) => [
    ...scopedPrefix('lead-messages', scope),
    ...(leadId ? [leadId] : []),
  ] as const,
  leadMessages: (
    scope: WhatsAppQueryScope,
    leadId: string | null,
    pageSize: number,
  ) => [
    ...scopedPrefix('lead-messages', scope),
    leadId,
    pageSize,
  ] as const,
}

const WHATSAPP_QUERY_ROOTS = new Set([
  'whatsapp-sessions',
  'whatsapp-session',
  'whatsapp-session-access',
  'accessible-sessions',
  'whatsapp-conversations',
  'whatsapp-conversation',
  'whatsapp-messages',
  'whatsapp-messages-paginated',
  'lead-messages',
])

export function isWhatsAppQueryKey(queryKey: QueryKey): boolean {
  return typeof queryKey[0] === 'string' && WHATSAPP_QUERY_ROOTS.has(queryKey[0])
}

export function isWhatsAppQueryKeyForScope(
  queryKey: QueryKey,
  scope: WhatsAppQueryScope,
): boolean {
  if (!isWhatsAppQueryKey(queryKey)) return false

  return queryKey[1] === WHATSAPP_SCOPE_MARKER
    && queryKey[2] === (scope.organizationId ?? MISSING_SCOPE_VALUE)
    && queryKey[3] === (scope.userId ?? MISSING_SCOPE_VALUE)
    && queryKey[4] === scope.accessScope
}

export function matchesWhatsAppMessagesQueryKey(
  queryKey: QueryKey,
  scope: WhatsAppQueryScope,
  conversationId?: string | null,
  leadId?: string | null,
): boolean {
  if (queryKey[0] !== 'whatsapp-messages' || !isWhatsAppQueryKeyForScope(queryKey, scope)) {
    return false
  }

  return Boolean(
    (conversationId && queryKey[5] === conversationId)
      || (leadId && queryKey[6] === leadId),
  )
}

export function matchesPaginatedWhatsAppMessagesQueryKey(
  queryKey: QueryKey,
  scope: WhatsAppQueryScope,
  conversationId: string,
): boolean {
  return queryKey[0] === 'whatsapp-messages-paginated'
    && isWhatsAppQueryKeyForScope(queryKey, scope)
    && queryKey[5] === conversationId
}

export function matchesLeadMessagesQueryKey(
  queryKey: QueryKey,
  scope: WhatsAppQueryScope,
  leadId: string,
): boolean {
  return queryKey[0] === 'lead-messages'
    && isWhatsAppQueryKeyForScope(queryKey, scope)
    && queryKey[5] === leadId
}

type PendingMessageIdentity = {
  id: string
  message_id?: string | null
  client_message_id?: string | null
  status?: string | null
  sent_at?: string | null
}

const LOCAL_MESSAGE_STATUSES = new Set([
  'queued',
  'pending',
  'sending',
  'confirming',
  'failed',
  'error',
])

const messageAliases = (message: PendingMessageIdentity) =>
  [message.id, message.message_id, message.client_message_id]
    .filter((value): value is string => Boolean(value))

/**
 * Infinite history pages arrive newest-page first while each page is already
 * chronological. Reverse page order, keep row order, and collapse boundary or
 * optimistic/canonical duplicates by every known message identity.
 */
export function flattenWhatsAppMessagePages<T extends PendingMessageIdentity>(
  pages: readonly { messages: readonly T[] }[],
): T[] {
  const messages: T[] = []
  const aliasIndexes = new Map<string, number>()

  const orderedPages = [...pages].reverse()
  orderedPages.forEach((page) => {
    page.messages.forEach((message) => {
      const existingIndex = messageAliases(message)
        .map((alias) => aliasIndexes.get(alias))
        .find((index): index is number => index !== undefined)

      if (existingIndex !== undefined) {
        const canonical = { ...messages[existingIndex], ...message }
        messages[existingIndex] = canonical
        messageAliases(canonical).forEach((alias) => aliasIndexes.set(alias, existingIndex))
        return
      }

      const nextIndex = messages.length
      messages.push(message)
      messageAliases(message).forEach((alias) => aliasIndexes.set(alias, nextIndex))
    })
  })

  return messages
}

/**
 * Keeps a local delivery row visible while the provider/backend result is
 * uncertain. As soon as the server returns any matching id, the canonical row
 * replaces the local one atomically.
 */
export function mergeWhatsAppMessagesWithLocalState<T extends PendingMessageIdentity>(
  serverMessages: readonly T[],
  cachedMessages?: readonly T[],
): T[] {
  if (!cachedMessages?.length) return [...serverMessages]

  const serverAliases = new Set(serverMessages.flatMap(messageAliases))
  const localOnly = cachedMessages.filter((message) =>
    LOCAL_MESSAGE_STATUSES.has(message.status ?? '')
      && !messageAliases(message).some((alias) => serverAliases.has(alias)),
  )

  return [...serverMessages, ...localOnly].sort((left, right) =>
    (left.sent_at ?? '').localeCompare(right.sent_at ?? ''),
  )
}

const DEFINITIVE_SEND_FAILURES = [
  'rate_limit_local',
  'rate_limit_exceeded',
  'muitas requisi',
  'whatsapp_disconnected',
  'desconectada',
  'qr code',
  'not connected',
  'nao possui whatsapp',
  'nao esta registrado',
  'invalid number',
  'forbidden',
  'unauthorized',
  'permission denied',
]

export function getWhatsAppSendFailureStatus(errorMessage: string): 'confirming' | 'failed' {
  const normalizedMessage = errorMessage.toLowerCase()
  return DEFINITIVE_SEND_FAILURES.some((token) => normalizedMessage.includes(token))
    ? 'failed'
    : 'confirming'
}
