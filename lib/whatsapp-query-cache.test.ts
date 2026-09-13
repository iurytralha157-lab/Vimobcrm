import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWhatsAppAccessScope,
  flattenWhatsAppMessagePages,
  getWhatsAppSendFailureStatus,
  isWhatsAppQueryKeyForScope,
  isWhatsAppInboxWakePayload,
  matchesLeadMessagesQueryKey,
  matchesWhatsAppMessageRefreshQueryKey,
  matchesWhatsAppMessagesQueryKey,
  mergeWhatsAppLatestMessagePage,
  mergeWhatsAppMessagesWithLocalState,
  resolveWhatsAppConversationSessionFilter,
  resolveWhatsAppSessionStatus,
  shouldRebaseWhatsAppMessagePages,
  WHATSAPP_UNCERTAIN_SEND_TTL_MS,
  whatsappQueryKeys,
  whatsappInboxTopic,
  type WhatsAppQueryScope,
} from './whatsapp-query-cache'

test('normaliza apenas estados autoritativos da conexao WhatsApp', () => {
  assert.equal(resolveWhatsAppSessionStatus({ connected: true, status: 'unknown' }), 'connected')
  assert.equal(resolveWhatsAppSessionStatus({ connected: false, status: 'disconnected' }), 'disconnected')
  assert.equal(resolveWhatsAppSessionStatus({ status: 'qr_ready', state: 'qr' }), 'qr_ready')
  assert.equal(resolveWhatsAppSessionStatus({ status: 'unexpected', state: 'unknown' }), null)
  assert.equal(resolveWhatsAppSessionStatus(undefined), null)
})

const scopeA: WhatsAppQueryScope = {
  organizationId: 'organization-a',
  userId: 'user-a',
  accessScope: 'role:user',
}

const scopeB: WhatsAppQueryScope = {
  organizationId: 'organization-b',
  userId: 'user-a',
  accessScope: 'role:user',
}

test('segrega as chaves por organizacao, usuario e escopo de acesso', () => {
  const keyA = whatsappQueryKeys.messages(scopeA, {
    conversationId: 'conversation-a',
    leadId: 'lead-a',
    limit: 50,
    includeLeadHistory: false,
  })
  const keyB = whatsappQueryKeys.messages(scopeB, {
    conversationId: 'conversation-a',
    leadId: 'lead-a',
    limit: 50,
    includeLeadHistory: false,
  })

  assert.notDeepEqual(keyA, keyB)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeA), true)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeB), false)
  assert.equal(matchesWhatsAppMessagesQueryKey(keyA, scopeA, 'conversation-a'), true)
  assert.equal(matchesWhatsAppMessagesQueryKey(keyA, scopeB, 'conversation-a'), false)
})

test('segrega o historico paginado do lead pelo mesmo escopo de acesso', () => {
  const keyA = whatsappQueryKeys.leadMessages(scopeA, 'lead-a', 40)
  const keyB = whatsappQueryKeys.leadMessages(scopeB, 'lead-a', 40)

  assert.notDeepEqual(keyA, keyB)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeA), true)
  assert.equal(matchesLeadMessagesQueryKey(keyA, scopeA, 'lead-a'), true)
  assert.equal(matchesLeadMessagesQueryKey(keyA, scopeA, 'lead-b'), false)
  assert.equal(matchesLeadMessagesQueryKey(keyA, scopeB, 'lead-a'), false)
})

test('reconcilia o envio nas consultas simples e paginadas da conversa ativa', () => {
  const conversationIds = ['conversation-a', 'conversation-canonical']
  const simpleKey = whatsappQueryKeys.messages(scopeA, {
    conversationId: 'conversation-a',
    leadId: 'lead-a',
    limit: 50,
    includeLeadHistory: false,
  })
  const paginatedKey = whatsappQueryKeys.paginatedMessages(scopeA, 'conversation-canonical', 50)
  const unrelatedKey = whatsappQueryKeys.paginatedMessages(scopeA, 'conversation-b', 50)

  assert.equal(
    matchesWhatsAppMessageRefreshQueryKey(simpleKey, scopeA, conversationIds, 'lead-a'),
    true,
  )
  assert.equal(
    matchesWhatsAppMessageRefreshQueryKey(paginatedKey, scopeA, conversationIds, 'lead-a'),
    true,
  )
  assert.equal(
    matchesWhatsAppMessageRefreshQueryKey(unrelatedKey, scopeA, conversationIds, 'lead-a'),
    false,
  )
  assert.equal(
    matchesWhatsAppMessageRefreshQueryKey(paginatedKey, scopeB, conversationIds, 'lead-a'),
    false,
  )
})

test('segrega sessoes e acesso por organizacao, usuario e permissoes', () => {
  const sessionsA = whatsappQueryKeys.sessions(scopeA)
  const sessionsB = whatsappQueryKeys.sessions(scopeB)
  const accessA = whatsappQueryKeys.sessionAccess(scopeA, 'session-a')

  assert.notDeepEqual(sessionsA, sessionsB)
  assert.equal(isWhatsAppQueryKeyForScope(sessionsA, scopeA), true)
  assert.equal(isWhatsAppQueryKeyForScope(sessionsA, scopeB), false)
  assert.equal(isWhatsAppQueryKeyForScope(accessA, scopeA), true)
})

test('segrega paginas de conversa por tenant e por filtros aplicados no servidor', () => {
  const baseParams = {
    hideGroups: false,
    showArchived: false,
    onlyLeads: true,
    withoutLead: false,
    pendingReply: true,
    search: 'maria',
    accessibleSessionKey: 'all',
    limit: 80,
  }
  const keyA = whatsappQueryKeys.conversations(scopeA, baseParams)
  const keyOtherTenant = whatsappQueryKeys.conversations(scopeB, baseParams)
  const keyOtherFilter = whatsappQueryKeys.conversations(scopeA, {
    ...baseParams,
    onlyLeads: false,
    withoutLead: true,
  })

  assert.notDeepEqual(keyA, keyOtherTenant)
  assert.notDeepEqual(keyA, keyOtherFilter)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeA), true)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeB), false)
})

test('segrega o contador leve pelo tenant e pelos filtros do inbox', () => {
  const params = {
    hideGroups: false,
    showArchived: false,
    onlyLeads: false,
    withoutLead: false,
    pendingReply: false,
    search: '',
    accessibleSessionKey: 'all',
  }
  const keyA = whatsappQueryKeys.unreadCount(scopeA, params)
  const keyOtherTenant = whatsappQueryKeys.unreadCount(scopeB, params)
  const keyOtherSession = whatsappQueryKeys.unreadCount(scopeA, {
    ...params,
    accessibleSessionKey: 'session-a',
  })

  assert.notDeepEqual(keyA, keyOtherTenant)
  assert.notDeepEqual(keyA, keyOtherSession)
  assert.deepEqual(keyA.slice(0, 5), whatsappQueryKeys.conversationsScope(scopeA))
})

test('segrega deep link de lead por tenant ativo', () => {
  const keyA = whatsappQueryKeys.conversationForLead(scopeA, 'lead-a')
  const keyB = whatsappQueryKeys.conversationForLead(scopeB, 'lead-a')

  assert.notDeepEqual(keyA, keyB)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeA), true)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeB), false)
})

test('modo todos deixa o backend aplicar acesso por lead sem exigir sessao propria', () => {
  assert.deepEqual(resolveWhatsAppConversationSessionFilter('all', []), {})
  assert.deepEqual(
    resolveWhatsAppConversationSessionFilter('session-owned', ['session-owned']),
    { sessionId: 'session-owned' },
  )
  assert.deepEqual(
    resolveWhatsAppConversationSessionFilter('session-foreign', ['session-owned']),
    { accessibleSessionIds: [] },
  )
})

test('sinal privado do inbox nao aceita ids, status ou conteudo', () => {
  assert.equal(whatsappInboxTopic('organization-a'), 'whatsapp:organization-a:inbox')
  assert.equal(isWhatsAppInboxWakePayload({ scope: 'conversations' }), true)
  assert.equal(isWhatsAppInboxWakePayload({ scope: 'conversations', conversationId: 'secret' }), false)
  assert.equal(isWhatsAppInboxWakePayload({ scope: 'conversations', status: 'received' }), false)
  assert.equal(isWhatsAppInboxWakePayload({ scope: 'conversations', content: 'secret' }), false)
})

test('normaliza o escopo de acesso sem depender da ordem das permissoes', () => {
  const first = createWhatsAppAccessScope({
    memberRole: 'broker',
    permissions: ['whatsapp_send', 'whatsapp_view'],
    ledTeamIds: ['team-b', 'team-a'],
  })
  const second = createWhatsAppAccessScope({
    memberRole: 'broker',
    permissions: ['whatsapp_view', 'whatsapp_send'],
    ledTeamIds: ['team-a', 'team-b'],
  })

  assert.equal(first, second)
})

test('preserva mensagem local ate o servidor devolver a linha canonica', () => {
  const local = {
    id: 'client-1',
    message_id: 'client-1',
    client_message_id: 'client-1',
    status: 'confirming',
    sent_at: '2026-07-12T12:00:00.000Z',
    content: 'Oi',
  }

  const beforeTimeout = { nowMs: Date.parse(local.sent_at) + 1 }
  assert.deepEqual(mergeWhatsAppMessagesWithLocalState([], [local], beforeTimeout), [local])

  const canonical = {
    ...local,
    id: 'database-1',
    message_id: 'provider-1',
    status: 'sent',
  }
  assert.deepEqual(
    mergeWhatsAppMessagesWithLocalState([canonical], [local], beforeTimeout),
    [canonical],
  )
})

test('preserva todos os estados locais de entrega durante reconciliacao', () => {
  const statuses = ['queued', 'pending', 'sending', 'confirming', 'failed', 'error'] as const
  const cached = statuses.map((status, index) => ({
    id: `local-${index}`,
    message_id: `local-${index}`,
    client_message_id: `local-${index}`,
    status,
    sent_at: `2026-07-12T12:0${index}:00Z`,
  }))

  assert.deepEqual(
    mergeWhatsAppMessagesWithLocalState([], cached, {
      nowMs: Date.parse('2026-07-12T12:04:00Z'),
    }).map((message) => message.status),
    statuses,
  )
})

test('ordena paginas antigas antes das novas e elimina sobreposicao de cursor', () => {
  const pages = [
    { messages: [
      { id: 'message-3', message_id: 'provider-3', client_message_id: 'client-3', status: 'sent', sent_at: '2026-07-12T12:03:00Z' },
      { id: 'message-4', message_id: 'provider-4', status: 'sent', sent_at: '2026-07-12T12:04:00Z' },
    ] },
    { messages: [
      { id: 'message-1', message_id: 'provider-1', status: 'received', sent_at: '2026-07-12T12:01:00Z' },
      { id: 'message-2', message_id: 'provider-2', status: 'received', sent_at: '2026-07-12T12:02:00Z' },
      { id: 'local-3', message_id: 'local-3', client_message_id: 'client-3', status: 'confirming', sent_at: '2026-07-12T12:03:00Z' },
    ] },
  ]
  assert.deepEqual(
    flattenWhatsAppMessagePages(pages).map((message) => message.id),
    ['message-1', 'message-2', 'message-3', 'message-4'],
  )
})

test('atualiza somente a pagina recente e preserva o historico paginado', () => {
  const cachedPages = [
    {
      messages: [
        { id: 'message-3', message_id: 'provider-3', status: 'sent', sent_at: '2026-07-12T12:03:00Z' },
        { id: 'local-4', message_id: 'local-4', client_message_id: 'client-4', status: 'confirming', sent_at: '2026-07-12T12:04:00Z' },
      ],
      nextCursor: 'cursor-recent-old',
    },
    {
      messages: [
        { id: 'message-1', message_id: 'provider-1', status: 'received', sent_at: '2026-07-12T12:01:00Z' },
        { id: 'message-2', message_id: 'provider-2', status: 'received', sent_at: '2026-07-12T12:02:00Z' },
      ],
      nextCursor: 'cursor-older',
    },
  ]
  const latestPage = {
    messages: [
      { id: 'message-3', message_id: 'provider-3', status: 'delivered', sent_at: '2026-07-12T12:03:00Z' },
      { id: 'message-4', message_id: 'provider-4', client_message_id: 'client-4', status: 'sent', sent_at: '2026-07-12T12:04:00Z' },
      { id: 'message-5', message_id: 'provider-5', status: 'received', sent_at: '2026-07-12T12:05:00Z' },
    ],
    nextCursor: 'cursor-recent-new',
  }

  const merged = mergeWhatsAppLatestMessagePage(cachedPages, latestPage)

  assert.equal(merged.length, 2)
  assert.equal(merged[0].nextCursor, 'cursor-recent-new')
  assert.deepEqual(merged[0].messages.map((message) => message.id), ['message-3', 'message-4', 'message-5'])
  assert.deepEqual(merged[1].messages, cachedPages[1].messages)
  assert.equal(merged[1].nextCursor, cachedPages[1].nextCursor)
})

test('preserva a ponte entre a cabeca renovada e a proxima pagina antiga', () => {
  const baseTime = Date.parse('2026-07-12T10:00:00.000Z')
  const message = (index: number) => ({
    id: `message-${index}`,
    message_id: `provider-${index}`,
    status: 'received',
    sent_at: new Date(baseTime + index * 60_000).toISOString(),
  })
  const cachedPages = [
    { messages: Array.from({ length: 50 }, (_, index) => message(index + 51)), nextCursor: 'cursor-50' },
    { messages: Array.from({ length: 50 }, (_, index) => message(index + 1)), nextCursor: null },
  ]
  const latestPage = {
    messages: Array.from({ length: 50 }, (_, index) => message(index + 61)),
    nextCursor: 'cursor-60',
  }

  const mergedPages = mergeWhatsAppLatestMessagePage(cachedPages, latestPage)
  const flattenedIds = flattenWhatsAppMessagePages(mergedPages).map((item) => item.id)

  assert.equal(mergedPages[0].messages.length, 50)
  assert.equal(mergedPages.every((page) => page.messages.length <= 50), true)
  assert.deepEqual(flattenedIds, Array.from({ length: 110 }, (_, index) => `message-${index + 1}`))
  assert.equal(
    mergedPages[mergedPages.length - 1]?.nextCursor,
    cachedPages[cachedPages.length - 1]?.nextCursor,
  )
})

test('detecta salto sem sobreposicao para rebase controlado', () => {
  const canonical = (index: number): {
    id: string
    message_id: string
    client_message_id: string | null
    status: string
    sent_at: string
  } => ({
    id: `database-${index}`,
    message_id: `provider-${index}`,
    client_message_id: null,
    status: 'received',
    sent_at: `2026-07-12T12:${String(index).padStart(2, '0')}:00Z`,
  })

  assert.equal(
    shouldRebaseWhatsAppMessagePages(
      [canonical(1), canonical(2)],
      [canonical(3), canonical(4)],
    ),
    true,
  )
  assert.equal(
    shouldRebaseWhatsAppMessagePages(
      [canonical(1), canonical(2)],
      [canonical(2), canonical(3)],
    ),
    false,
  )
  assert.equal(
    shouldRebaseWhatsAppMessagePages(
      [{ ...canonical(1), id: 'client-1', message_id: 'client-1', client_message_id: 'client-1', status: 'confirming' }],
      [canonical(2)],
    ),
    false,
  )
})

test('encerra confirmacao local sem resposta depois do TTL e ainda aceita a linha canonica', () => {
  const sentAt = '2026-07-12T12:00:00.000Z'
  const sentAtMs = Date.parse(sentAt)
  const local: {
    id: string
    message_id: string
    client_message_id: string
    status: string
    sent_at: string
    media_error?: string | null
    metadata?: Record<string, unknown>
  } = {
    id: 'client-timeout',
    message_id: 'client-timeout',
    client_message_id: 'client-timeout',
    status: 'confirming',
    sent_at: sentAt,
  }

  const beforeTimeout = mergeWhatsAppMessagesWithLocalState([], [local], {
    nowMs: sentAtMs + WHATSAPP_UNCERTAIN_SEND_TTL_MS - 1,
  })
  assert.equal(beforeTimeout[0]?.status, 'confirming')

  const afterTimeout = mergeWhatsAppMessagesWithLocalState([], [local], {
    nowMs: sentAtMs + WHATSAPP_UNCERTAIN_SEND_TTL_MS,
  })
  assert.equal(afterTimeout[0]?.status, 'failed')
  assert.equal(afterTimeout[0]?.media_error, 'SEND_CONFIRMATION_TIMEOUT')
  assert.equal(afterTimeout[0]?.metadata?.local_delivery_state, 'confirmation_timeout')

  const canonical = {
    ...local,
    id: 'message-timeout',
    message_id: 'provider-timeout',
    status: 'delivered',
  }
  const reconciled = mergeWhatsAppMessagesWithLocalState([canonical], afterTimeout, {
    nowMs: sentAtMs + WHATSAPP_UNCERTAIN_SEND_TTL_MS + 1,
  })
  assert.deepEqual(reconciled, [canonical])
})

test('distingue falha definitiva de entrega incerta', () => {
  assert.equal(getWhatsAppSendFailureStatus('WHATSAPP_DISCONNECTED'), 'failed')
  assert.equal(getWhatsAppSendFailureStatus('WhatsApp selecionado esta desconectado.'), 'failed')
  assert.equal(
    getWhatsAppSendFailureStatus({
      message: 'You do not have permission to perform this action.',
      code: 'permission_denied',
      status: 403,
    }),
    'failed',
  )
  assert.equal(
    getWhatsAppSendFailureStatus({
      message: 'Contrato invalido na entrada',
      code: 'domain_validation_error',
      name: 'DomainValidationError',
      direction: 'input',
    }),
    'failed',
  )
  assert.equal(
    getWhatsAppSendFailureStatus({ message: 'Request timeout', status: 408 }),
    'confirming',
  )
  assert.equal(
    getWhatsAppSendFailureStatus({
      message: 'Resposta inesperada depois do envio',
      code: 'domain_validation_error',
      name: 'DomainValidationError',
      direction: 'response',
    }),
    'confirming',
  )
  assert.equal(getWhatsAppSendFailureStatus('api_timeout'), 'confirming')
  assert.equal(
    getWhatsAppSendFailureStatus('Mensagem enviada no WhatsApp, mas nao foi salva'),
    'confirming',
  )
})
