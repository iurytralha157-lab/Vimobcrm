import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureWhatsAppCanonicalConversationPreview,
  projectWhatsAppCanonicalConversationPreview,
} from './whatsapp-canonical-conversation-preview'

const ORGANIZATION = '10000000-0000-4000-8000-000000000001'
const USER = '20000000-0000-4000-8000-000000000001'
const CONVERSATION = '30000000-0000-4000-8000-000000000001'
const SESSION = '40000000-0000-4000-8000-000000000001'
const LEAD = '50000000-0000-4000-8000-000000000001'
const MESSAGE = '60000000-0000-4000-8000-000000000001'
const OTHER = '90000000-0000-4000-8000-000000000001'
const SENT_AT = '2026-10-14T12:00:00.123456Z'
const BEFORE = '2026-10-14T11:59:00Z'
const scope = Object.freeze({
  organizationId: ORGANIZATION,
  userId: USER,
  accessScope: 'role:broker|permissions:whatsapp_view|auth-session:session-a',
})
const context = Object.freeze({
  scope,
  conversationId: CONVERSATION,
  expectedLeadId: LEAD,
  expectedSessionId: SESSION,
  historyLeadId: null,
})

function rawMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE,
    conversation_id: CONVERSATION,
    session_id: SESSION,
    content: 'Mensagem canônica',
    message_type: 'text',
    from_me: true,
    status: 'delivered',
    sent_at: SENT_AT,
    ...overrides,
  }
}

type Card = {
  id: string
  session_id: string | null
  lead_id: string | null
  last_message: string | null
  last_message_at: string | null
  last_message_id?: string | null
  last_message_from_me?: boolean | null
  last_message_status?: string | null
  historical_lead_view?: boolean
  platform?: string | null
  unread_count: number
  updated_at: string
  contact_name: string
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: CONVERSATION,
    session_id: SESSION,
    lead_id: LEAD,
    last_message: 'Preview antigo',
    last_message_at: BEFORE,
    unread_count: 7,
    updated_at: BEFORE,
    contact_name: 'Contato sintético',
    ...overrides,
  }
}

function captured(overrides: Record<string, unknown> = {}) {
  const preview = captureWhatsAppCanonicalConversationPreview([rawMessage(overrides)], context)
  assert.ok(preview)
  return preview
}

test('captura identidade e tupla da mensagem de saída, sem alterar os argumentos', () => {
  const raw = Object.freeze(rawMessage())
  const messages = Object.freeze([raw])
  const preview = captureWhatsAppCanonicalConversationPreview(messages, context)
  assert.deepEqual(preview, {
    scope,
    conversationId: CONVERSATION,
    expectedLeadId: LEAD,
    sessionId: SESSION,
    messageId: MESSAGE,
    preview: 'Mensagem canônica',
    fromMe: true,
    status: 'delivered',
    sentAt: SENT_AT,
  })
  assert.deepEqual(raw, rawMessage())
})

test('preserva direção real da mensagem recebida mesmo com remetente igual ao usuário', () => {
  const preview = captured({ from_me: false, status: 'received', sender_user_id: USER })
  assert.equal(preview.fromMe, false)
  assert.equal(preview.status, 'received')
})

test('seleciona o último registro ASC sem ordenar UUIDs em timestamps empatados', () => {
  const rows = [
    rawMessage({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', content: 'Primeira' }),
    rawMessage({ id: '00000000-0000-4000-8000-000000000001', content: 'Última' }),
  ]
  const snapshot = structuredClone(rows)
  const preview = captureWhatsAppCanonicalConversationPreview(rows, context)
  assert.equal(preview?.messageId, rows[1].id)
  assert.equal(preview?.preview, 'Última')
  assert.deepEqual(rows, snapshot)
})

test('resposta vazia, histórico de lead e contexto incompleto não capturam preview', () => {
  assert.equal(captureWhatsAppCanonicalConversationPreview([], context), null)
  for (const change of [
    { historyLeadId: LEAD },
    { expectedLeadId: null },
    { expectedLeadId: undefined },
    { expectedSessionId: null },
    { expectedSessionId: undefined },
    { conversationId: '' },
  ]) {
    // Exercise missing runtime context even though callers use a typed contract.
    const incomplete = { ...context, ...change } as Parameters<typeof captureWhatsAppCanonicalConversationPreview>[1]
    assert.equal(captureWhatsAppCanonicalConversationPreview([rawMessage()], incomplete), null)
  }
})

test('valida CID e sessão de todas as linhas, inclusive anteriores à cabeça', () => {
  for (const change of [
    { conversation_id: OTHER }, { conversation_id: null }, { conversation_id: 'client-cid' },
    { session_id: OTHER }, { session_id: null }, { session_id: 'local-session' },
  ]) {
    assert.equal(captureWhatsAppCanonicalConversationPreview([
      rawMessage(change), rawMessage(),
    ], context), null)
  }
})

test('última linha inválida não permite reaproveitar a linha boa anterior', () => {
  const invalid = [
    { id: 'client-optimistic' }, { id: null }, { id: '' },
    { from_me: undefined }, { from_me: null }, { from_me: 'true' },
    { status: undefined }, { status: null }, { status: '' }, { status: 'unknown-provider-status' },
    { content: undefined }, { content: 42 },
    { message_type: undefined }, { message_type: '' }, { message_type: 42 },
    { sent_at: undefined }, { sent_at: null }, { sent_at: 'not-a-date' },
    { sent_at: '2026-02-30T12:00:00Z' },
    { metadata: { local_delivery_state: 'confirmation_timeout' } },
  ]
  for (const change of invalid) {
    assert.equal(captureWhatsAppCanonicalConversationPreview([
      rawMessage({ id: OTHER, sent_at: BEFORE }), rawMessage(change),
    ], context), null, JSON.stringify(change))
  }
})

test('pula somente reações explícitas e conserva a última mensagem não reação', () => {
  for (const messageType of ['reaction', 'REACTION']) {
    const preview = captureWhatsAppCanonicalConversationPreview([
      rawMessage(),
      rawMessage({ id: OTHER, message_type: messageType, reaction_to_message_id: MESSAGE, content: '👍' }),
    ], context)
    assert.equal(preview?.messageId, MESSAGE)
    assert.equal(preview?.preview, 'Mensagem canônica')
  }
  const reactions = Array.from({ length: 50 }, () => rawMessage({
    message_type: 'reaction', reaction_to_message_id: MESSAGE, content: '👍',
  }))
  assert.equal(captureWhatsAppCanonicalConversationPreview(reactions, context), null)
})

test('reação de outra conversa ou sessão invalida a resposta inteira', () => {
  for (const change of [{ conversation_id: OTHER }, { session_id: OTHER }]) {
    assert.equal(captureWhatsAppCanonicalConversationPreview([
      rawMessage(), rawMessage({
        id: OTHER, message_type: 'reaction', reaction_to_message_id: MESSAGE, ...change,
      }),
    ], context), null)
  }
})

test('legendas e placeholders de mídia seguem o preview canônico', () => {
  const types = [
    ['image', '[Imagem]'], ['video', '[Video]'], ['audio', '[Audio]'],
    ['document', '[Documento]'], ['sticker', '[Figurinha]'], ['text', '[Mensagem]'],
  ]
  for (const [message_type, placeholder] of types) {
    assert.equal(captured({ message_type, content: null }).preview, placeholder)
    assert.equal(captured({ message_type, content: '' }).preview, placeholder)
    assert.equal(captured({ message_type, content: '  Legenda preservada  ' }).preview,
      '  Legenda preservada  ')
  }
})

test('substitui a tupla completa do card existente e preserva ordem, horário e originais', () => {
  const before = Object.freeze(card({ id: OTHER }))
  const target = Object.freeze(card())
  const after = Object.freeze(card({ id: '90000000-0000-4000-8000-000000000002' }))
  const conversations = [before, target, after]
  const snapshot = structuredClone(conversations)
  const projected = projectWhatsAppCanonicalConversationPreview(conversations, captured(), scope)
  assert.notStrictEqual(projected, conversations)
  assert.strictEqual(projected[0], before)
  assert.strictEqual(projected[2], after)
  assert.notStrictEqual(projected[1], target)
  assert.deepEqual(projected[1], {
    ...target,
    last_message_id: MESSAGE,
    last_message_sent_at: captured().sentAt,
    last_message: 'Mensagem canônica',
    last_message_from_me: true,
    last_message_status: 'delivered',
  })
  assert.deepEqual(conversations, snapshot)
  assert.deepEqual(projected.map(({ id }) => id), conversations.map(({ id }) => id))
})

test('presença autoritativa dos campos, inclusive nulos e tuplas incompletas, suprime fallback', () => {
  for (const fields of [
    { last_message_from_me: true, last_message_status: 'sent' },
    { last_message_from_me: false, last_message_status: 'received' },
    { last_message_from_me: null, last_message_status: null },
    { last_message_from_me: null }, { last_message_status: null },
    { last_message_from_me: undefined }, { last_message_status: undefined },
  ]) {
    const conversations = [card(fields)]
    assert.strictEqual(projectWhatsAppCanonicalConversationPreview(conversations, captured(), scope), conversations)
  }
})

test('não mistura escopos de organização, usuário, permissão ou AuthSID', () => {
  const conversations = [card()]
  const preview = captured()
  for (const currentScope of [
    { ...scope, organizationId: OTHER },
    { ...scope, userId: OTHER },
    { ...scope, accessScope: 'role:admin|auth-session:session-a' },
    { ...scope, accessScope: scope.accessScope.replace('session-a', 'session-b') },
  ]) {
    assert.strictEqual(projectWhatsAppCanonicalConversationPreview(conversations, preview, currentScope), conversations)
  }
})

test('não projeta sobre outro card, sessão, histórico ou plataforma', () => {
  for (const change of [
    { id: OTHER }, { id: 'client-cid' }, { lead_id: OTHER }, { lead_id: null },
    { session_id: OTHER }, { session_id: null }, { historical_lead_view: true },
    { platform: 'instagram' }, { platform: 'messenger' },
  ]) {
    const conversations = [card(change)]
    assert.strictEqual(projectWhatsAppCanonicalConversationPreview(conversations, captured(), scope), conversations)
  }
})

test('horário apenas limita frescor e nunca identifica mensagem por texto ou data', () => {
  const preview = captured()
  for (const last_message_at of [null, '', 'not-a-date', '2026-10-14T12:01:00Z']) {
    const conversations = [card({ last_message_at })]
    assert.strictEqual(projectWhatsAppCanonicalConversationPreview(conversations, preview, scope), conversations)
  }
  const sameTextOtherCard = [card({ id: OTHER, last_message: preview.preview, last_message_at: SENT_AT })]
  assert.strictEqual(projectWhatsAppCanonicalConversationPreview(sameTextOtherCard, preview, scope), sameTextOtherCard)
  const equalTime = [card({ last_message: 'Texto diferente', last_message_at: SENT_AT })]
  const projected = projectWhatsAppCanonicalConversationPreview(equalTime, preview, scope)
  assert.equal(projected[0].last_message, preview.preview)
  assert.equal(projected[0].last_message_at, SENT_AT)
})

test('frescor conserva microssegundos e aceita timezone equivalente sem trocar o horário', () => {
  const preview = captured()
  const newer = [card({ last_message_at: '2026-10-14T12:00:00.123457Z' })]
  assert.strictEqual(projectWhatsAppCanonicalConversationPreview(newer, preview, scope), newer)
  const equivalent = [card({ last_message_at: '2026-10-14T09:00:00.123456-03:00' })]
  const projected = projectWhatsAppCanonicalConversationPreview(equivalent, preview, scope)
  assert.equal(projected[0].last_message_id, MESSAGE)
  assert.equal(projected[0].last_message_at, equivalent[0].last_message_at)
})

test('aceita conversa sem lead somente com snapshot unlinked explícito e mantém direção recebida', () => {
  const preview = captureWhatsAppCanonicalConversationPreview([
    rawMessage({ from_me: false, status: 'received' }),
  ], { ...context, expectedLeadId: 'unlinked' })
  assert.ok(preview)
  const conversations = [card({ lead_id: null })]
  const projected = projectWhatsAppCanonicalConversationPreview(conversations, preview, scope)
  assert.equal(projected[0].last_message_from_me, false)
  assert.equal(projected[0].last_message_status, 'received')
  const linked = [card()]
  assert.strictEqual(projectWhatsAppCanonicalConversationPreview(linked, preview, scope), linked)
})

test('captura aceita timezone real e projeção nula não cria nem altera cards', () => {
  const preview = captured({ sent_at: '2026-10-14T09:00:00.123456-03:00' })
  assert.equal(preview.sentAt, '2026-10-14T09:00:00.123456-03:00')
  const conversations = [card()]
  assert.strictEqual(projectWhatsAppCanonicalConversationPreview(conversations, null, scope), conversations)
  const empty: Card[] = []
  assert.strictEqual(projectWhatsAppCanonicalConversationPreview(empty, preview, scope), empty)
})

test('alvo de reação vazio continua não nulo e excluído do preview como na projeção SQL', () => {
  const reaction = rawMessage({ id: OTHER, message_type: 'text', reaction_to_message_id: '' })
  const afterMessage = captureWhatsAppCanonicalConversationPreview([rawMessage(), reaction], context)
  const onlyReaction = captureWhatsAppCanonicalConversationPreview([reaction], context)
  assert.deepEqual([afterMessage?.messageId, onlyReaction], [MESSAGE, null])
})

test('lead_id e lead.id válidos mas contraditórios impedem fallback no mesmo card físico', () => {
  const conversations = [{ ...card(), lead: { id: OTHER } }]
  const snapshot = structuredClone(conversations)
  assert.strictEqual(projectWhatsAppCanonicalConversationPreview(conversations, captured(), scope), conversations)
  assert.deepEqual(conversations, snapshot)
})

test('UUID local que coincide com alias não vira cabeça canônica nem reaproveita a anterior', () => {
  const queued = captured({ status: 'queued', client_message_id: OTHER, message_id: 'provider-queued-1' })
  assert.equal(queued.messageId, MESSAGE)
  assert.equal(queued.status, 'queued')
  const invalidHeads = [
    { status: 'pending', client_message_id: MESSAGE, message_id: 'provider-local-1' },
    { status: 'failed', message_id: MESSAGE },
    {
      id: '6a000000-0000-4000-8000-000000000001',
      status: 'pending',
      client_message_id: '  6A000000-0000-4000-8000-000000000001  ',
      message_id: 'provider-local-uppercase',
    },
  ]
  const snapshots = invalidHeads.map(change => captureWhatsAppCanonicalConversationPreview([
    rawMessage({ id: OTHER, sent_at: BEFORE }), rawMessage(change),
  ], context))
  assert.deepEqual(snapshots, [null, null, null])
})
