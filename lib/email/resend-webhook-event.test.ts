import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRecordResendEmailEventArgs,
  persistResendEmailEvent,
} from './resend-webhook-event'

const event = {
  type: 'email.delivered',
  created_at: '2026-08-03T20:30:00.000Z',
  data: {
    email_id: 'email-provider-id',
    to: ['cliente@example.com'],
  },
}

test('mapeia o evento verificado para o contrato idempotente da RPC', () => {
  assert.deepEqual(buildRecordResendEmailEventArgs(event, ' msg_webhook_123 '), {
    p_provider_event_id: 'msg_webhook_123',
    p_provider_message_id: 'email-provider-id',
    p_event_type: 'email.delivered',
    p_occurred_at: '2026-08-03T20:30:00.000Z',
    p_payload: event.data,
  })
})

test('rejeita evento sem identificador do e-mail e evento fora do domínio email', () => {
  assert.throws(
    () => buildRecordResendEmailEventArgs({ ...event, data: {} }, 'event-1'),
    /data\.email_id/,
  )
  assert.throws(
    () => buildRecordResendEmailEventArgs({ ...event, type: 'contact.created' }, 'event-1'),
    /Only Resend email events/,
  )
})

test('responde 200 e marca reentrega idempotente como duplicada', async () => {
  const args = buildRecordResendEmailEventArgs(event, 'event-duplicate')
  const result = await persistResendEmailEvent(args, async () => ({
    data: false,
    error: null,
  }))

  assert.deepEqual(result, {
    ok: true,
    status: 200,
    duplicate: true,
  })
})

test('transforma falha e exceção da RPC em erro 500 controlado', async () => {
  const args = buildRecordResendEmailEventArgs(event, 'event-failed')
  const rpcError = new Error('database unavailable')

  const failed = await persistResendEmailEvent(args, async () => ({
    data: null,
    error: rpcError,
  }))
  assert.equal(failed.ok, false)
  assert.equal(failed.status, 500)

  const thrown = await persistResendEmailEvent(args, async () => {
    throw rpcError
  })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.status, 500)
})
