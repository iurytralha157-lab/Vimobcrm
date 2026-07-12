import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWhatsAppSessionInputSchema,
  sendWhatsAppMessageInputSchema,
  whatsAppMessagesResponseSchema,
  whatsAppSessionsResponseSchema,
} from './whatsapp'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

test('aceita sessao Evolution GO e rejeita provider legado', () => {
  assert.equal(createWhatsAppSessionInputSchema.safeParse({
    displayName: 'Atendimento',
    provider: 'evolution_go',
  }).success, true)
  assert.equal(createWhatsAppSessionInputSchema.safeParse({
    displayName: 'Atendimento',
    provider: 'evolution',
  }).success, false)
})

test('exige texto ou midia no envio', () => {
  assert.equal(sendWhatsAppMessageInputSchema.safeParse({ text: 'Ola' }).success, true)
  assert.equal(sendWhatsAppMessageInputSchema.safeParse({ text: '', mediaUrl: 'https://example.com/foto.jpg' }).success, true)
  assert.equal(sendWhatsAppMessageInputSchema.safeParse({ text: '' }).success, false)
})

test('valida lista de sessoes e cota', () => {
  const result = whatsAppSessionsResponseSchema.safeParse({
    data: [{
      id: ID,
      organization_id: ORG_ID,
      owner_user_id: USER_ID,
      instance_name: 'org-atendimento',
      display_name: 'Atendimento',
      instance_id: null,
      status: 'connected',
      phone_number: '5511999999999',
      profile_name: null,
      profile_picture: null,
      is_active: true,
      provider: 'evolution_go',
      created_at: '2026-07-11T12:00:00Z',
      updated_at: '2026-07-11T12:00:00Z',
      last_connected_at: null,
    }],
    meta: { maxSessions: 2, currentSessions: 1, canCreate: true },
  })

  assert.equal(result.success, true)
})

test('rejeita pagina de mensagens com contador negativo', () => {
  const result = whatsAppMessagesResponseSchema.safeParse({
    data: {
      messages: [{
        id: ID,
        conversation_id: ORG_ID,
        session_id: USER_ID,
        message_id: 'provider-message-id',
        from_me: false,
        content: null,
        message_type: 'audio',
        media_url: null,
        media_mime_type: null,
        media_size: -1,
        status: 'received',
        sent_at: '2026-07-11T12:00:00Z',
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: null,
      }],
      nextCursor: null,
    },
  })

  assert.equal(result.success, false)
})
