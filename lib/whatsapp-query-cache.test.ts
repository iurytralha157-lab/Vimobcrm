import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWhatsAppAccessScope,
  flattenWhatsAppMessagePages,
  getWhatsAppSendFailureStatus,
  isWhatsAppQueryKeyForScope,
  isWhatsAppInboxWakePayload,
  matchesLeadMessagesQueryKey,
  matchesWhatsAppAttendanceQueryKey,
  matchesPaginatedWhatsAppMessagesQueryKey,
  matchesWhatsAppMessageRefreshQueryKey,
  matchesWhatsAppMessagesQueryKey,
  mergeWhatsAppLatestMessagePage,
  mergeWhatsAppHistoricalMessagePage,
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

test('segrega catálogo temporal e atribuição avançada no cache de lista e contador', () => {
  const base = { hideGroups: false, showArchived: false, onlyLeads: false, withoutLead: false,
    pendingReply: false, accessibleSessionKey: 'authorized-sessions', limit: 80 };
  for (const change of [{ adSetId: 'set-a' }, { adId: 'ad-a' },
    { leadCreatedFrom: '2026-10-01T03:00:00Z' }, { leadCreatedTo: '2026-10-13T02:59:59Z' }]) {
    assert.notDeepEqual(whatsappQueryKeys.conversations(scopeA, base), whatsappQueryKeys.conversations(scopeA, { ...base, ...change }));
    assert.notDeepEqual(whatsappQueryKeys.unreadCount(scopeA, base), whatsappQueryKeys.unreadCount(scopeA, { ...base, ...change }));
    assert.equal(isWhatsAppQueryKeyForScope(whatsappQueryKeys.conversations(scopeA, { ...base, ...change }), scopeA), true);
    assert.equal(isWhatsAppQueryKeyForScope(whatsappQueryKeys.conversations(scopeB, { ...base, ...change }), scopeA), false);
  }
});

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
  assert.equal(matchesWhatsAppMessagesQueryKey(keyA, scopeA, 'conversation-a', 'lead-b'), false)
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

test('segrega o historico paginado da conversa pelo card esperado', () => {
  const keyLeadA = whatsappQueryKeys.paginatedMessages(
    scopeA,
    'conversation-a',
    50,
    'lead-a',
  )
  const keyLeadB = whatsappQueryKeys.paginatedMessages(
    scopeA,
    'conversation-a',
    50,
    'lead-b',
  )

  assert.notDeepEqual(keyLeadA, keyLeadB)
  assert.equal(
    matchesPaginatedWhatsAppMessagesQueryKey(keyLeadA, scopeA, 'conversation-a', 'lead-a'),
    true,
  )
  assert.equal(
    matchesPaginatedWhatsAppMessagesQueryKey(keyLeadA, scopeA, 'conversation-a', 'lead-b'),
    false,
  )

  const keyUnlinked = whatsappQueryKeys.paginatedMessages(
    scopeA,
    'conversation-a',
    50,
    'unlinked',
  )
  const keyMissingSnapshot = whatsappQueryKeys.paginatedMessages(
    scopeA,
    'conversation-a',
    50,
    null,
  )
  assert.notDeepEqual(keyUnlinked, keyLeadA)
  assert.notDeepEqual(keyUnlinked, keyMissingSnapshot)
  assert.equal(
    matchesPaginatedWhatsAppMessagesQueryKey(keyUnlinked, scopeA, 'conversation-a', 'unlinked'),
    true,
  )
  assert.equal(
    matchesPaginatedWhatsAppMessagesQueryKey(keyUnlinked, scopeA, 'conversation-a', 'lead-a'),
    false,
  )
})

test('segrega o atendimento por tenant, conversa, card e WhatsApp selecionado', () => {
  const keyA = whatsappQueryKeys.attendance(scopeA, 'conversation-a', 'lead-a', 'session-a')
  const otherTenant = whatsappQueryKeys.attendance(scopeB, 'conversation-a', 'lead-a', 'session-a')
  const otherCard = whatsappQueryKeys.attendance(scopeA, 'conversation-a', 'lead-b', 'session-a')
  const otherSession = whatsappQueryKeys.attendance(scopeA, 'conversation-a', 'lead-a', 'session-b')

  assert.notDeepEqual(keyA, otherTenant)
  assert.notDeepEqual(keyA, otherCard)
  assert.notDeepEqual(keyA, otherSession)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeA), true)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeB), false)
  assert.equal(matchesWhatsAppAttendanceQueryKey(keyA, scopeA, ['conversation-a'], []), true)
  assert.equal(matchesWhatsAppAttendanceQueryKey(keyA, scopeA, [], ['lead-a']), true)
  assert.equal(matchesWhatsAppAttendanceQueryKey(keyA, scopeA, ['conversation-b'], ['lead-b']), false)
  assert.equal(matchesWhatsAppAttendanceQueryKey(keyA, scopeB, ['conversation-a'], ['lead-a']), false)
})

test('reconcilia o envio nas consultas simples e paginadas da conversa ativa', () => {
  const conversationIds = ['conversation-a', 'conversation-canonical']
  const simpleKey = whatsappQueryKeys.messages(scopeA, {
    conversationId: 'conversation-a',
    leadId: 'lead-a',
    limit: 50,
    includeLeadHistory: false,
  })
  const paginatedKey = whatsappQueryKeys.paginatedMessages(scopeA, 'conversation-canonical', 50, 'lead-a')
  const unrelatedKey = whatsappQueryKeys.paginatedMessages(scopeA, 'conversation-b', 50, 'lead-a')

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
  const keyOtherPeriod = whatsappQueryKeys.conversations(scopeA, {
    ...baseParams,
    lastMessageFrom: '2026-10-01T00:00:00.000Z',
    lastMessageTo: '2026-10-04T23:59:59.999Z',
  })
  const keyOtherSource = whatsappQueryKeys.conversations(scopeA, {
    ...baseParams,
    leadSource: 'meta',
  })

  assert.notDeepEqual(keyA, keyOtherTenant)
  assert.notDeepEqual(keyA, keyOtherFilter)
  assert.notDeepEqual(keyA, keyOtherPeriod)
  assert.notDeepEqual(keyA, keyOtherSource)
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
  const keyOtherPeriod = whatsappQueryKeys.unreadCount(scopeA, {
    ...params,
    lastMessageFrom: '2026-10-01T00:00:00.000Z',
  })
  const keyOtherSource = whatsappQueryKeys.unreadCount(scopeA, {
    ...params,
    leadSource: 'whatsapp',
  })

  assert.notDeepEqual(keyA, keyOtherTenant)
  assert.notDeepEqual(keyA, keyOtherSession)
  assert.notDeepEqual(keyA, keyOtherPeriod)
  assert.notDeepEqual(keyA, keyOtherSource)
  assert.deepEqual(keyA.slice(0, 5), whatsappQueryKeys.conversationsScope(scopeA))
})

test('segrega deep link de lead por tenant ativo', () => {
  const keyA = whatsappQueryKeys.conversationForLead(scopeA, 'lead-a')
  const keyB = whatsappQueryKeys.conversationForLead(scopeB, 'lead-a')

  assert.notDeepEqual(keyA, keyB)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeA), true)
  assert.equal(isWhatsAppQueryKeyForScope(keyA, scopeB), false)
})

test('segrega snapshot de deep link por conversa e tenant ativo', () => {
  const keyA = whatsappQueryKeys.conversationSnapshot(scopeA, 'conversation-a')
  const keyOtherConversation = whatsappQueryKeys.conversationSnapshot(scopeA, 'conversation-b')
  const keyOtherTenant = whatsappQueryKeys.conversationSnapshot(scopeB, 'conversation-a')

  assert.notDeepEqual(keyA, keyOtherConversation)
  assert.notDeepEqual(keyA, keyOtherTenant)
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

test('sinal do inbox invalida tambem o contador de nao lidas no mesmo escopo', () => {
  const conversationScope = whatsappQueryKeys.conversationsScope(scopeA)
  const unreadCountKey = whatsappQueryKeys.unreadCount(scopeA, {
    hideGroups: false,
    showArchived: false,
    onlyLeads: false,
    withoutLead: false,
    pendingReply: false,
    accessibleSessionKey: 'all',
  })

  assert.deepEqual(unreadCountKey.slice(0, conversationScope.length), conversationScope)
  assert.notDeepEqual(
    unreadCountKey.slice(0, conversationScope.length),
    whatsappQueryKeys.conversationsScope(scopeB),
  )
})

test('sinal privado do inbox aceita apenas o id tecnico do Realtime, sem dados do chat', () => {
  assert.equal(whatsappInboxTopic('organization-a'), 'whatsapp:organization-a:inbox')
  assert.equal(isWhatsAppInboxWakePayload({ scope: 'conversations' }), true)
  assert.equal(isWhatsAppInboxWakePayload({
    id: '12345678-1234-4234-8234-123456789abc',
    scope: 'conversations',
  }), true)
  assert.equal(isWhatsAppInboxWakePayload({ scope: 'conversations', id: 'secret' }), false)
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

test('mantem a ordem canonica e coloca a mensagem local depois no mesmo instante', () => {
  // Go omits a zero fraction while optimistic JavaScript rows keep milliseconds.
  const canonical = ['capture-0', 'capture-1', 'capture-2'].map((id) => ({
    id, message_id: `provider-${id}`, status: 'received', sent_at: '2026-10-11T12:00:00Z',
  }))
  const local = {
    id: 'local-send', message_id: 'local-send', client_message_id: 'local-send',
    status: 'confirming', sent_at: '2026-10-11T12:00:00.000Z',
  }
  const expected = ['capture-0', 'capture-1', 'capture-2', 'local-send']

  assert.deepEqual(mergeWhatsAppMessagesWithLocalState(canonical, [local]).map((row) => row.id), expected)
  const refreshed = mergeWhatsAppLatestMessagePage(
    [{ messages: [canonical[0], local], nextCursor: null }],
    { messages: canonical, nextCursor: null },
  )
  assert.deepEqual(flattenWhatsAppMessagePages(refreshed).map((row) => row.id), expected)
})

test('preserva ordem v2 entre paginas, cabeca sobreposta e substituicao otimista', () => {
  const canonical = (index: number, clientMessageId?: string) => ({
    id: `capture-${index}`, message_id: `provider-${index}`, client_message_id: clientMessageId,
    status: 'received', sent_at: '2026-10-11T12:00:00.123456Z',
  })
  const cached = [
    { messages: [canonical(2), { ...canonical(3, 'local-3'), id: 'local-3', message_id: 'local-3', status: 'confirming' }], nextCursor: 'v2-boundary-2' },
    { messages: [canonical(0), canonical(1)], nextCursor: 'v2-boundary-0' },
  ]
  const refreshed = mergeWhatsAppLatestMessagePage(cached,
    { messages: [canonical(2), canonical(3, 'local-3'), canonical(4)], nextCursor: 'v2-boundary-new' },
    { pageSize: 3 })
  const withOlder = [...refreshed, { messages: [canonical(-1)], nextCursor: null }]
  assert.deepEqual(flattenWhatsAppMessagePages(withOlder).map(({ id }) => id),
    ['capture--1', 'capture-0', 'capture-1', 'capture-2', 'capture-3', 'capture-4'])
  assert.equal(refreshed.at(-1)?.nextCursor, 'v2-boundary-0')
  assert.equal(flattenWhatsAppMessagePages(withOlder).find(({ id }) => id === 'capture-3')?.status, 'received')
})

test('separa cache v2 dos cursores antigos sem alterar os indices de autorizacao', () => {
  const paginated = whatsappQueryKeys.paginatedMessages(scopeA, 'conversation-a', 40, 'lead-a')
  const history = whatsappQueryKeys.leadMessages(scopeA, 'lead-a', 40)
  const messages = whatsappQueryKeys.messages(scopeA, {
    conversationId: 'conversation-a', leadId: 'lead-a', limit: 40, includeLeadHistory: true,
  })
  assert.equal(paginated.at(-1), 'ordering-v2')
  assert.equal(history.at(-1), 'ordering-v2')
  assert.equal(messages.at(-1), 'ordering-v2')
  assert.equal(paginated[5], 'conversation-a')
  assert.equal(paginated[7], 'lead-a')
  assert.equal(history[5], 'lead-a')
  assert.equal(matchesPaginatedWhatsAppMessagesQueryKey(paginated, scopeA, 'conversation-a', 'lead-a'), true)
})

test('segrega a projecao historica por conversa e card esperado', () => {
  const cardA = whatsappQueryKeys.conversationHistoryProjection(scopeA, 'conversation-a', 'lead-a')
  const cardB = whatsappQueryKeys.conversationHistoryProjection(scopeA, 'conversation-a', 'lead-b')
  const otherConversation = whatsappQueryKeys.conversationHistoryProjection(scopeA, 'conversation-b', 'lead-a')

  assert.notDeepEqual(cardA, cardB)
  assert.notDeepEqual(cardA, otherConversation)
  assert.equal(isWhatsAppQueryKeyForScope(cardA, scopeA), true)
  assert.equal(isWhatsAppQueryKeyForScope(cardA, scopeB), false)
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

test('mantem envio local sem confirmacao apos TTL e ainda aceita a linha canonica', () => {
  const sentAt = '2026-07-12T12:00:00.000Z'
  const sentAtMs = Date.parse(sentAt)
  const local: {
    id: string
    message_id: string
    client_message_id: string
    status: string
    sent_at: string
    media_error?: string | null
    delivery_error_code?: string | null
    delivery_failed_at?: string | null
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
  assert.equal(afterTimeout[0]?.status, 'unconfirmed')
  assert.equal(afterTimeout[0]?.media_error, undefined)
  assert.equal(afterTimeout[0]?.delivery_error_code, 'outcome_unknown')
  assert.equal(afterTimeout[0]?.delivery_failed_at, null)
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

test('na pagina mais recente, ausência de confirmação não vira falha nem duplica a mensagem canônica', () => {
  const sentAt = '2026-07-12T12:00:00.000Z'
  const local = {
    id: 'client-delayed',
    message_id: 'client-delayed',
    client_message_id: 'client-delayed',
    status: 'confirming',
    sent_at: sentAt,
  }
  const latestEmpty = { messages: [] as typeof local[], nextCursor: null }
  const [stillLocal] = mergeWhatsAppLatestMessagePage([{
    messages: [local],
    nextCursor: null,
  }], latestEmpty, { nowMs: Date.parse(sentAt) + WHATSAPP_UNCERTAIN_SEND_TTL_MS })
  assert.equal(stillLocal.messages[0]?.status, 'unconfirmed')

  const canonical = { ...local, id: 'canonical-delayed', message_id: 'provider-delayed', status: 'sent' }
  const [confirmed] = mergeWhatsAppLatestMessagePage([stillLocal], {
    messages: [canonical],
    nextCursor: null,
  })
  assert.equal(confirmed.messages.length, 1)
  assert.deepEqual(confirmed.messages[0], canonical)
})

test('revalidacao historica substitui DTO canonico, preserva janela, cursores e optimistic CID', () => {
  const old = { id: 'old', status: 'received', content: 'private', quoted_message: { content: 'old quote' } }
  const optimistic = { id: 'client-one', message_id: 'client-one', client_message_id: 'client-one', status: 'confirming', content: 'keep draft outcome' }
  const recent = { id: 'recent', status: 'received', content: 'recent' }
  const pages = [{ messages: [recent, optimistic], nextCursor: 'older' }, { messages: [old], nextCursor: 'not-loaded' }]
  const deleted = { id: 'old', status: 'received', content: 'Esta mensagem foi apagada', message_type: 'deleted' }
  const refreshed = mergeWhatsAppHistoricalMessagePage(pages, [deleted, { id: 'outside-window', status: 'received', content: 'do not append' }], pages.flatMap(page => page.messages))
  assert.strictEqual(refreshed[0], pages[0])
  assert.strictEqual(refreshed[0].messages[1], optimistic)
  assert.deepEqual(refreshed[1].messages, [deleted])
  assert.equal('quoted_message' in refreshed[1].messages[0], false)
  assert.equal(refreshed[1].nextCursor, 'not-loaded')
})

test('revalidacao historica antiga nao sobrescreve uma linha alterada apos o snapshot', () => {
  const snapshot = { id: 'old', message_id: 'provider-old', status: 'sent' }
  const current = { ...snapshot, status: 'read' }
  const pages = [{ messages: [current], nextCursor: null }]
  const freshOlderResponse = { ...snapshot, status: 'delivered' }
  assert.strictEqual(mergeWhatsAppHistoricalMessagePage(pages, [freshOlderResponse], [snapshot]), pages)
  assert.equal(pages[0].messages[0].status, 'read')
})

test('revalidacao historica reconcilia pelo client id sem duplicar e ignora fora da janela', () => {
  const pending = { id: 'client-one', message_id: 'client-one', client_message_id: 'client-one', status: 'confirming' }
  const pages = [{ messages: [pending], nextCursor: 'older' }]
  const canonical = { id: 'row-one', message_id: 'provider-one', client_message_id: 'client-one', status: 'delivered' }
  const refreshed = mergeWhatsAppHistoricalMessagePage(pages, [canonical], [pending])
  assert.deepEqual(refreshed[0].messages, [canonical])
  assert.equal(refreshed[0].nextCursor, 'older')
  assert.strictEqual(mergeWhatsAppHistoricalMessagePage(refreshed, [{ ...canonical, id: 'outside', message_id: 'other-provider', client_message_id: 'other-client' }], [canonical]), refreshed)
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
  assert.equal(getWhatsAppSendFailureStatus({
    message: 'number 5511999999999@s.whatsapp.net is not registered on WhatsApp',
    status: 500,
  }), 'confirming')
  assert.equal(
    getWhatsAppSendFailureStatus('Mensagem enviada no WhatsApp, mas nao foi salva'),
    'confirming',
  )
})
