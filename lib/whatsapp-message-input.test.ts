import assert from 'node:assert/strict'
import test from 'node:test'

import { getWhatsAppSendSessionId } from './whatsapp-message-input'

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
