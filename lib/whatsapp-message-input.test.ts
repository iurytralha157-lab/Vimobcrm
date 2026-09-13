import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getWhatsAppMessageInputState,
  getWhatsAppSendSessionId,
} from './whatsapp-message-input'

test('historical conversation without a trusted session cannot fall back to another account', () => {
  const result = getWhatsAppSendSessionId(
    { id: '50000000-0000-4000-8000-000000000001', session_id: null },
    '40000000-0000-4000-8000-000000000002',
    [{ id: '40000000-0000-4000-8000-000000000002' }],
  )

  assert.equal(result, undefined)
})

test('authorized persisted conversation keeps its own session', () => {
  const result = getWhatsAppSendSessionId(
    {
      id: '50000000-0000-4000-8000-000000000001',
      session_id: '40000000-0000-4000-8000-000000000001',
    },
    null,
    [{ id: '40000000-0000-4000-8000-000000000002' }],
  )

  assert.equal(result, '40000000-0000-4000-8000-000000000001')
})

test('new conversation draft may use the explicitly selected session', () => {
  const result = getWhatsAppSendSessionId(
    { session_id: null },
    '40000000-0000-4000-8000-000000000002',
    [{ id: '40000000-0000-4000-8000-000000000002' }],
  )

  assert.equal(result, '40000000-0000-4000-8000-000000000002')
})

test('usa o status atual da lista de integracoes no lugar do status antigo da conversa', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: 'session-1',
      contact_phone: '5511999999999',
      remote_jid: '5511999999999@s.whatsapp.net',
      session: {
        id: 'session-1',
        status: 'disconnected',
        provider: 'evolution_go',
      },
    },
    null,
    [{ id: 'session-1', status: 'connected', provider: 'evolution_go' }],
  )

  assert.deepEqual(state, {
    disabled: false,
    placeholder: 'Digite sua mensagem...',
    sendSessionId: 'session-1',
  })
})

test('deixa o backend validar uma unica integracao configurada que aparece desconectada', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: 'session-1',
      contact_phone: '5511999999999',
      remote_jid: '5511999999999@s.whatsapp.net',
      session: {
        id: 'session-1',
        status: 'connected',
        provider: 'evolution_go',
      },
    },
    null,
    [{ id: 'session-1', status: 'disconnected', provider: 'evolution_go' }],
  )

  assert.deepEqual(state, {
    disabled: false,
    placeholder: 'Digite sua mensagem...',
    sendSessionId: 'session-1',
  })
})

test('permite iniciar conversa no detalhe de um lead ainda sem historico', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: null,
      contact_phone: '5511999999999',
      remote_jid: null,
      is_group: false,
      session: null,
    },
    null,
    [{ id: 'session-1', status: 'connected', provider: 'evolution_go' }],
  )

  assert.deepEqual(state, {
    disabled: false,
    placeholder: 'Digite sua mensagem...',
    sendSessionId: 'session-1',
  })
})

test('nao escolhe uma conta arbitraria quando ha varias integracoes desconectadas', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: null,
      contact_phone: '5511999999999',
      remote_jid: null,
      is_group: false,
      session: null,
    },
    null,
    [
      { id: 'session-1', status: 'disconnected', provider: 'evolution_go' },
      { id: 'session-2', status: 'disconnected', provider: 'evolution_go' },
    ],
  )

  assert.equal(state.disabled, true)
  assert.equal(state.sendSessionId, undefined)
})

test('exige selecao quando ha varias integracoes conectadas e a conversa antiga esta offline', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: 'session-old',
      contact_phone: '5511999999999',
      remote_jid: '5511999999999@s.whatsapp.net',
      session: {
        id: 'session-old',
        status: 'disconnected',
        provider: 'evolution_go',
      },
    },
    null,
    [
      { id: 'session-old', status: 'disconnected', provider: 'evolution_go' },
      { id: 'session-1', status: 'connected', provider: 'evolution_go' },
      { id: 'session-2', status: 'connected', provider: 'evolution_go' },
    ],
  )

  assert.equal(state.disabled, true)
  assert.equal(state.sendSessionId, undefined)
})
