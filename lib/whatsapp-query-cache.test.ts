import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWhatsAppAccessScope,
  flattenWhatsAppMessagePages,
  getWhatsAppSendFailureStatus,
  isWhatsAppQueryKeyForScope,
  isWhatsAppInboxWakePayload,
  matchesLeadMessagesQueryKey,
  matchesWhatsAppMessagesQueryKey,
  mergeWhatsAppMessagesWithLocalState,
  resolveWhatsAppConversationSessionFilter,
  resolveWhatsAppSessionStatus,
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

  assert.deepEqual(mergeWhatsAppMessagesWithLocalState([], [local]), [local])

  const canonical = {
    ...local,
    id: 'database-1',
    message_id: 'provider-1',
    status: 'sent',
  }
  assert.deepEqual(
    mergeWhatsAppMessagesWithLocalState([canonical], [local]),
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
    mergeWhatsAppMessagesWithLocalState([], cached).map((message) => message.status),
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

test('distingue falha definitiva de entrega incerta', () => {
  assert.equal(getWhatsAppSendFailureStatus('WHATSAPP_DISCONNECTED'), 'failed')
  assert.equal(getWhatsAppSendFailureStatus('api_timeout'), 'confirming')
  assert.equal(
    getWhatsAppSendFailureStatus('Mensagem enviada no WhatsApp, mas nao foi salva'),
    'confirming',
  )
})
