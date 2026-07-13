import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWhatsAppSessionInputSchema,
  reactWhatsAppMessageInputSchema,
  reactWhatsAppMessageResponseSchema,
  sendWhatsAppMessageResponseSchema,
  sendWhatsAppMessageInputSchema,
  whatsAppHistoryResponseSchema,
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

test('aceita cursor composto de mensagens e rejeita desempate invalido', () => {
  const base = {
    data: {
      messages: [],
      nextCursor: `2026-07-12T12:00:00.123456Z|${ID}`,
    },
  }

  assert.equal(whatsAppMessagesResponseSchema.safeParse(base).success, true)
  assert.equal(whatsAppMessagesResponseSchema.safeParse({
    data: { messages: [], nextCursor: '2026-07-12T12:00:00Z|not-a-uuid' },
  }).success, false)
})

test('valida cursor composto no historico paginado do lead', () => {
  assert.equal(whatsAppHistoryResponseSchema.safeParse({
    data: {
      messages: [],
      nextCursor: `2026-07-12T12:00:00.123456Z|${ID}`,
    },
  }).success, true)
  assert.equal(whatsAppHistoryResponseSchema.safeParse({
    data: {
      messages: [],
      nextCursor: '2026-07-12T12:00:00Z|not-a-uuid',
    },
  }).success, false)

  assert.equal(whatsAppHistoryResponseSchema.safeParse({
    data: {
      messages: [{
        id: ID,
        conversation_id: ORG_ID,
        session_id: null,
        message_id: 'legacy-message-without-trusted-session',
        from_me: false,
        content: 'Historico legado',
        message_type: 'text',
        media_url: null,
        media_mime_type: null,
        status: 'received',
        sent_at: '2026-07-12T12:00:00Z',
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: null,
      }],
      nextCursor: null,
    },
  }).success, true)
})

test('valida resposta de envio com mensagem canonica na fila', () => {
  const result = sendWhatsAppMessageResponseSchema.safeParse({
    clientMessageId: 'client-message-id',
    conversationId: ORG_ID,
    status: 'queued',
    message: {
      id: ID,
      conversation_id: ORG_ID,
      session_id: USER_ID,
      message_id: 'client-message-id',
      client_message_id: 'client-message-id',
      from_me: true,
      content: 'Ola',
      message_type: 'text',
      media_url: null,
      media_mime_type: null,
      status: 'queued',
      sent_at: '2026-07-12T12:00:00Z',
      delivered_at: null,
      read_at: null,
      sender_jid: null,
      sender_name: 'Corretor',
    },
  })

  assert.equal(result.success, true)
})

test('reacao exige chave idempotente e aceita remocao com emoji vazio', () => {
  assert.equal(reactWhatsAppMessageInputSchema.safeParse({
    emoji: '',
    clientReactionId: 'reaction-client-1',
  }).success, true)
  assert.equal(reactWhatsAppMessageInputSchema.safeParse({ emoji: '👍' }).success, false)
  assert.equal(reactWhatsAppMessageInputSchema.safeParse({
    emoji: '👍'.repeat(65),
    clientReactionId: 'reaction-client-2',
  }).success, false)
})

test('valida resposta canonica da reacao enfileirada', () => {
  assert.equal(reactWhatsAppMessageResponseSchema.safeParse({
    clientReactionId: 'reaction-client-1',
    conversationId: ORG_ID,
    targetMessageId: ID,
    targetProviderMessageId: 'provider-target-1',
    status: 'queued',
    reaction: {
      id: ID,
      conversation_id: ORG_ID,
      session_id: USER_ID,
      message_id: 'reaction-provider-id',
      client_message_id: 'reaction-client-1',
      from_me: true,
      content: '👍',
      message_type: 'reaction',
      media_url: null,
      media_mime_type: null,
      reaction_to_message_id: 'provider-target-1',
      reaction_emoji: '👍',
      status: 'queued',
      sent_at: '2026-07-12T12:00:00Z',
      delivered_at: null,
      read_at: null,
      sender_jid: null,
      sender_name: 'Corretor',
    },
  }).success, true)
})
