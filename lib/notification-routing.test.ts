import assert from 'node:assert/strict'
import test from 'node:test'
import { getNotificationRoute, getPushNotificationRoute } from './notification-routing'

const lead = '11111111-1111-4111-8111-111111111111'
const conversation = '22222222-2222-4222-8222-222222222222'
const target = `/crm/conversas?conversation=${conversation}&lead=${lead}`
const notification = { title: 'Nova mensagem no WhatsApp', content: 'Você recebeu uma mensagem.', type: 'whatsapp', lead_id: lead, target_url: `/crm?leadId=${lead}`, metadata: { whatsapp_conversation_id: conversation } }

test('durable inbound notification opens its conversation in app and native push', () => {
  assert.equal(getNotificationRoute(notification, { canViewWhatsApp: true }), target)
  assert.equal(getPushNotificationRoute({ ...notification }, { canViewWhatsApp: true }), target)
  assert.equal(getPushNotificationRoute({ ...notification, target_url: target }, { canViewWhatsApp: true }), target)
})
test('legacy WhatsApp lead targets and missing metadata have usable fallbacks', () => {
  assert.equal(getNotificationRoute({ ...notification, metadata: {} }, { canViewWhatsApp: true }), `/crm/conversas?lead=${lead}`)
  assert.equal(getPushNotificationRoute({ type: 'whatsapp', target_url: `/crm?leadId=${lead}` }, { canViewWhatsApp: true }), `/crm/conversas?lead=${lead}`)
  assert.equal(getPushNotificationRoute({ type: 'whatsapp', conversationId: 'invalid', lead_id: 'invalid' }, { canViewWhatsApp: true }), '/crm/conversas')
})
test('permission removal prevents opening WhatsApp and external targets remain internal', () => {
  assert.equal(getNotificationRoute(notification), null)
  assert.equal(getPushNotificationRoute(notification), '/notifications')
  assert.equal(getPushNotificationRoute({ url: 'https://other.example/crm' }), '/notifications')
  assert.equal(getPushNotificationRoute({ type: 'whatsapp', url: 'https://other.example/crm' }, { canViewWhatsApp: true }), '/crm/conversas')
})
