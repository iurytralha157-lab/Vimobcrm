import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { clearUnavailableWhatsAppLeadCache, clearUnavailableWhatsAppMessageCache, isWhatsAppAccessUnavailable } from './whatsapp-access-revocation'
import { whatsappQueryKeys, type WhatsAppQueryScope } from './whatsapp-query-cache'

test('access denial clears history and attendance only for the affected tenant and user', () => {
  const client = new QueryClient()
  const scope: WhatsAppQueryScope = { organizationId: 'org-a', userId: 'user-a', accessScope: 'user' }
  const keys = [
    whatsappQueryKeys.paginatedMessages(scope, 'chat-a', 30, 'lead-a'),
    whatsappQueryKeys.conversation(scope, 'chat-a', 'lead-a'),
    whatsappQueryKeys.conversationSnapshot(scope, 'chat-a'),
    whatsappQueryKeys.conversationHistoryProjection(scope, 'chat-a', 'lead-a'),
    whatsappQueryKeys.attendance(scope, 'chat-a', 'lead-a', 'session-a'),
    whatsappQueryKeys.leadMessagesScope(scope, 'lead-a'),
  ]
  const otherKeys = [
    whatsappQueryKeys.paginatedMessages(scope, 'chat-b', 30, 'lead-b'),
    whatsappQueryKeys.paginatedMessages({ ...scope, organizationId: 'org-b' }, 'chat-a', 30, 'lead-a'),
    whatsappQueryKeys.paginatedMessages({ ...scope, userId: 'user-b' }, 'chat-a', 30, 'lead-a'),
  ]
  for (const key of [...keys, ...otherKeys]) client.setQueryData(key, ['private message'])
  clearUnavailableWhatsAppMessageCache(client, scope, 'chat-a', 'lead-a')
  for (const key of keys) assert.equal(client.getQueryData(key), undefined)
  for (const key of otherKeys) assert.deepEqual(client.getQueryData(key), ['private message'])
  client.clear()
})

test('network and server failures do not revoke access', () => {
  for (const status of [403, 404, 410]) assert.equal(isWhatsAppAccessUnavailable({ status }), true)
  for (const error of [null, new Error('offline'), { status: 500 }, { status: 429 }]) {
    assert.equal(isWhatsAppAccessUnavailable(error), false)
  }
})

test('only the real reference denial is treated as unavailable among 400 and 409 errors', () => {
  assert.equal(isWhatsAppAccessUnavailable({ status: 400, code: 'invalid_whatsapp_reference' }), true)
  for (const error of [
    { status: 400, code: 'invalid_whatsapp_input' },
    { status: 400 },
    { status: 409, code: 'whatsapp_message_cursor_rebase_required' },
  ]) assert.equal(isWhatsAppAccessUnavailable(error), false)
})

test('lead denial purges its conversations and history without crossing tenant, user or another lead', () => {
  const client = new QueryClient()
  const scope: WhatsAppQueryScope = { organizationId: 'org-a', userId: 'user-a', accessScope: 'user' }
  const affected = [
    whatsappQueryKeys.leadMessages(scope, 'lead-a', 40),
    whatsappQueryKeys.paginatedMessages(scope, 'chat-a', 30, 'lead-a'),
    [...whatsappQueryKeys.paginatedMessages(scope, 'chat-historical', 30, 'lead-b'), 'lead-history:lead-a'],
    whatsappQueryKeys.conversationHistoryProjection(scope, 'chat-a', 'lead-a'),
    whatsappQueryKeys.attendance(scope, 'chat-a', 'lead-a', 'session-a'),
    whatsappQueryKeys.conversationSnapshot(scope, 'chat-a'),
  ]
  const unrelated = [
    whatsappQueryKeys.leadMessages(scope, 'lead-b', 40),
    whatsappQueryKeys.leadMessages({ ...scope, organizationId: 'org-b' }, 'lead-a', 40),
    whatsappQueryKeys.leadMessages({ ...scope, userId: 'user-b' }, 'lead-a', 40),
    whatsappQueryKeys.conversationSnapshot(scope, 'chat-b'),
  ]
  for (const key of affected) client.setQueryData(key, { lead_id: 'lead-a', private: true })
  for (const key of unrelated) client.setQueryData(key, { lead_id: 'lead-b', keep: true })
  clearUnavailableWhatsAppLeadCache(client, scope, 'lead-a')
  for (const key of affected) assert.equal(client.getQueryData(key), undefined)
  for (const key of unrelated) assert.deepEqual(client.getQueryData(key), { lead_id: 'lead-b', keep: true })
  client.clear()
})
