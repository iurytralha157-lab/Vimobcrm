import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'

import { whatsappQueryKeys, type WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'
import {
  clearWhatsAppUnlinkedMessageCache,
  getWhatsAppUnlinkedExpiresAt,
  isUnavailableWhatsAppConversationError,
  isWhatsAppUnlinkedExpired,
  refreshWhatsAppUnlinkedInbox,
  scheduleWhatsAppUnlinkedExpiration,
} from '@/lib/whatsapp-unlinked-expiration'

const scope: WhatsAppQueryScope = {
  organizationId: 'organization-a',
  userId: 'user-a',
  accessScope: 'owner',
}

test('conversa sem lead atravessa o limite de sete dias da criacao e limpa apenas seu historico', () => {
  const conversationId = 'conversation-a'
  const expiresAt = getWhatsAppUnlinkedExpiresAt({
    created_at: '2026-10-01T12:00:00.000Z',
    lead_id: null,
    is_group: false,
  })
  assert.equal(expiresAt, Date.parse('2026-10-08T12:00:00.000Z'))
  assert.equal(isWhatsAppUnlinkedExpired(expiresAt, expiresAt! - 1), false)
  assert.equal(isWhatsAppUnlinkedExpired(expiresAt, expiresAt!), true)

  const client = new QueryClient()
  const unlinkedPaginated = [
    ...whatsappQueryKeys.paginatedMessages(scope, conversationId, 50, 'unlinked'),
    'current-conversation',
    'lazy-media-urls',
  ]
  const unlinkedSimple = whatsappQueryKeys.messages(scope, {
    conversationId, leadId: 'unlinked', limit: 50, includeLeadHistory: false,
  })
  const leadPaginated = whatsappQueryKeys.paginatedMessages(scope, conversationId, 50, 'lead-a')
  const otherOrganization = whatsappQueryKeys.paginatedMessages(
    { ...scope, organizationId: 'organization-b' }, conversationId, 50, 'unlinked',
  )
  client.setQueryData(unlinkedPaginated, { pages: [{ messages: ['old'] }], pageParams: [null] })
  client.setQueryData(unlinkedSimple, ['old'])
  client.setQueryData(leadPaginated, { pages: [{ messages: ['lead'] }], pageParams: [null] })
  client.setQueryData(otherOrganization, { pages: [{ messages: ['other'] }], pageParams: [null] })

  if (isWhatsAppUnlinkedExpired(expiresAt, expiresAt!)) {
    clearWhatsAppUnlinkedMessageCache(client, scope, conversationId)
  }
  assert.equal(client.getQueryData(unlinkedPaginated), undefined)
  assert.equal(client.getQueryData(unlinkedSimple), undefined)
  assert.notEqual(client.getQueryData(leadPaginated), undefined)
  assert.notEqual(client.getQueryData(otherOrganization), undefined)
  client.clear()
})

test('conversa de lead, grupo e historico vinculado nao seguem o corte sem lead', () => {
  const created_at = '2026-10-01T12:00:00.000Z'
  assert.equal(getWhatsAppUnlinkedExpiresAt({ created_at, lead_id: 'lead-a' }), null)
  assert.equal(getWhatsAppUnlinkedExpiresAt({ created_at, lead: { id: 'lead-a' } }), null)
  assert.equal(getWhatsAppUnlinkedExpiresAt({ created_at, is_group: true }), null)
  assert.equal(getWhatsAppUnlinkedExpiresAt({ created_at, historical_lead_view: true }), null)
  assert.equal(getWhatsAppUnlinkedExpiresAt({ created_at: 'invalid' }), null)
})

test('corte sem lead invalida lista e contador apenas no escopo atual', () => {
  const client = new QueryClient()
  const prefix = whatsappQueryKeys.conversationsScope(scope)
  const listKey = [...prefix, 'all']
  const unreadKey = [...prefix, 'unread-count', 'all']
  const otherOrganizationKey = [...whatsappQueryKeys.conversationsScope({
    ...scope, organizationId: 'organization-b',
  }), 'all']
  client.setQueryData(listKey, ['conversation-a'])
  client.setQueryData(unreadKey, 1)
  client.setQueryData(otherOrganizationKey, ['other'])

  refreshWhatsAppUnlinkedInbox(client, scope)

  assert.equal(client.getQueryState(listKey)?.isInvalidated, true)
  assert.equal(client.getQueryState(unreadKey)?.isInvalidated, true)
  assert.equal(client.getQueryState(otherOrganizationKey)?.isInvalidated, false)
  client.clear()
})

test('404 e 410 encerram o chat sem lead; falhas transitorias nao', () => {
  assert.equal(isUnavailableWhatsAppConversationError({ status: 404 }), true)
  assert.equal(isUnavailableWhatsAppConversationError({ status: 410 }), true)
  assert.equal(isUnavailableWhatsAppConversationError({ status: 503 }), false)
  assert.equal(isUnavailableWhatsAppConversationError(new Error('network')), false)
})

test('temporizador fecha o chat ao atravessar o prazo e pode ser cancelado', async () => {
  let expired = 0
  const deadline = scheduleWhatsAppUnlinkedExpiration(Date.now() + 30, () => { expired += 1 })
  deadline.check()
  assert.equal(expired, 0)
  await new Promise((resolve) => setTimeout(resolve, 70))
  assert.equal(expired, 1)
  deadline.check()
  assert.equal(expired, 1)
  deadline.cancel()

  const cancelled = scheduleWhatsAppUnlinkedExpiration(Date.now() + 20, () => { expired += 1 })
  cancelled.cancel()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(expired, 1)
})
