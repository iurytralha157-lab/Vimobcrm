import assert from 'node:assert/strict'
import test from 'node:test'
import type { SendWhatsAppMessageResult, WhatsAppMessage } from './api/whatsapp'
import { canDiscardFailedLocalWhatsAppMessage, getWhatsAppSendIntentResolution, getWhatsAppAudioSendResult, getWhatsAppFileSendFeedback, isWhatsAppConversationSelectionCurrent } from './whatsapp-send-intent'

const expected = { conversationId: 'conversation-a', clientMessageId: 'intent-a' }
const message = (overrides: Partial<WhatsAppMessage> = {}) => ({ id: 'canonical-id', conversation_id: expected.conversationId, client_message_id: expected.clientMessageId, message_id: 'provider-id', from_me: true, status: 'queued', ...overrides } as WhatsAppMessage)
const result = (value: WhatsAppMessage | undefined) => ({ ...expected, status: 'queued', message: value } as SendWhatsAppMessageResult)

test('uncertain POST resolves only from its exact persisted authorized intent', () => {
  for (const status of ['queued', 'pending', 'sending', 'sent', 'delivered', 'read', 'played']) {
    assert.equal(getWhatsAppSendIntentResolution(result(message({ status })), expected), 'accepted')
  }
  for (const changed of [{ conversation_id: 'conversation-b' }, { client_message_id: 'intent-b' }, { client_message_id: null }, { from_me: false }, { metadata: { local_delivery_state: 'confirming' } }]) {
    assert.equal(getWhatsAppSendIntentResolution(result(message(changed)), expected), 'pending')
  }
  assert.equal(getWhatsAppSendIntentResolution({ ...result(message()), conversationId: 'conversation-b' }, expected), 'pending')
  assert.equal(getWhatsAppSendIntentResolution(result(undefined), expected), 'pending')
})

test('unknown delivery remains blocked while definitive failure permits explicit recovery', () => {
  assert.equal(getWhatsAppSendIntentResolution(result(message({ status: 'sent', delivery_error_code: 'outcome_unknown' })), expected), 'pending')
  assert.equal(getWhatsAppSendIntentResolution(result(message({ status: 'failed', delivery_error_code: 'outcome_unknown' })), expected), 'pending')
  assert.equal(getWhatsAppSendIntentResolution(result(message({ status: 'failed' })), expected), 'pending')
  for (const delivery_error_code of ['recipient_not_registered', 'send_failed'] as const) {
    assert.equal(getWhatsAppSendIntentResolution(result(message({ status: 'failed', delivery_error_code })), expected), 'failed')
  }
})

test('discard never removes canonical history or a send awaiting confirmation', () => {
  const local = message({ id: 'intent-a', message_id: 'intent-a', status: 'failed', metadata: { local_delivery_state: 'failed' } })
  assert.equal(canDiscardFailedLocalWhatsAppMessage(local), true)
  assert.equal(canDiscardFailedLocalWhatsAppMessage(message({ status: 'failed' })), false)
  assert.equal(canDiscardFailedLocalWhatsAppMessage({ ...local, id: 'canonical-id' }), false)
  assert.equal(canDiscardFailedLocalWhatsAppMessage({ ...local, metadata: { local_delivery_state: 'confirming' } }), false)
})

test('audio response classifies canonical failures and preserves the original uncertain intent', () => {
  for (const status of ['queued', 'sending', 'sent', 'delivered']) {
    assert.deepEqual(getWhatsAppAudioSendResult(result(message({ status })), 'audio-original'), { state: 'queued', clientMessageId: 'audio-original' })
  }
  for (const failed of [message({ status: 'failed', delivery_error_code: 'outcome_unknown' }), message({ status: 'failed' }), message({ status: 'confirming' })]) {
    assert.deepEqual(getWhatsAppAudioSendResult(result(failed), 'audio-original'), { state: 'unconfirmed', clientMessageId: 'audio-original' })
  }
  for (const delivery_error_code of ['recipient_not_registered', 'send_failed'] as const) {
    assert.equal(getWhatsAppAudioSendResult(result(message({ status: 'failed', delivery_error_code })), 'audio-original'), false)
  }
})

test('file feedback requires the exact canonical outgoing intent before announcing acceptance', () => {
  assert.equal(getWhatsAppFileSendFeedback(result(message()), expected).state, 'queued')
  for (const invalid of [undefined, message({ conversation_id: 'conversation-b' }), message({ client_message_id: 'intent-b' }), message({ from_me: false }), message({ metadata: { local_delivery_state: 'queued' } })]) {
    const feedback = getWhatsAppFileSendFeedback(result(invalid), expected)
    assert.equal(feedback.state, 'unconfirmed')
    assert.equal(feedback.title, 'Confirmando envio')
  }
})

test('file feedback distinguishes definitive rejection from an unknown outcome without provider details', () => {
  for (const delivery_error_code of ['recipient_not_registered', 'send_failed'] as const) {
    const feedback = getWhatsAppFileSendFeedback(result(message({ status: 'failed', delivery_error_code })), expected)
    assert.equal(feedback.state, 'failed')
    assert.equal(feedback.title, 'Arquivo não enviado')
    assert.equal(feedback.variant, 'destructive')
  }
  for (const value of [message({ status: 'failed' }), message({ status: 'failed', delivery_error_code: 'outcome_unknown' }), message({ status: 'confirming' })]) {
    assert.equal(getWhatsAppFileSendFeedback(result(value), expected).state, 'unconfirmed')
  }
})

test('file verification carries the explicit authorized resolution without fabricating a message', () => {
  const states = { accepted: 'queued', failed: 'failed', pending: 'unconfirmed', cancelled: 'cancelled' } as const
  for (const fileIntentResolution of ['accepted', 'failed', 'pending', 'cancelled'] as const) {
    const checked: SendWhatsAppMessageResult = { ...expected, fileIntentChecked: true, fileIntentResolution }
    assert.equal(getWhatsAppFileSendFeedback(checked, expected).state, states[fileIntentResolution])
    assert.equal(checked.message, undefined); assert.equal(checked.status, undefined)
    assert.equal(getWhatsAppSendIntentResolution(checked, expected), 'pending', 'local metadata does not replace canonical evidence for other senders')
    if (fileIntentResolution === 'accepted') assert.equal(getWhatsAppFileSendFeedback(checked, expected).title, 'Envio verificado')
  }
})

test('file verification resolution cannot settle another conversation or client intent', () => {
  for (const changed of [{ conversationId: 'different' }, { clientMessageId: 'different' }, { fileIntentChecked: false }]) {
    const checked: SendWhatsAppMessageResult = { ...expected, fileIntentChecked: true, fileIntentResolution: 'accepted', ...changed }
    assert.equal(getWhatsAppFileSendFeedback(checked, expected).state, 'unconfirmed')
  }
  assert.equal(getWhatsAppFileSendFeedback({ ...expected, fileIntentChecked: true }, expected).state, 'unconfirmed')
})

test('physical conversation fence permits own preparation and rejects replacement or ABA', () => {
  const selected = { conversationId: 'conversation-a', previousConversationId: null, generation: 5 }
  const empty = { conversationId: null, previousConversationId: null, generation: 5 }
  assert.equal(isWhatsAppConversationSelectionCurrent(selected, selected, 'conversation-a'), true)
  assert.equal(isWhatsAppConversationSelectionCurrent(selected, selected, 'conversation-b'), false)
  assert.equal(isWhatsAppConversationSelectionCurrent(empty, empty, 'conversation-a'), true)
  assert.equal(isWhatsAppConversationSelectionCurrent({ ...selected, generation: 6 }, empty, 'conversation-a'), true)
  for (const current of [
    { ...selected, conversationId: 'conversation-b', previousConversationId: 'conversation-a', generation: 6 },
    { ...selected, previousConversationId: 'conversation-b', generation: 7 },
    { ...empty, previousConversationId: 'conversation-a', generation: 6 },
  ]) assert.equal(isWhatsAppConversationSelectionCurrent(current, selected, 'conversation-a'), false)
  assert.equal(isWhatsAppConversationSelectionCurrent({ ...selected, generation: 8 }, empty, 'conversation-a'), false)
  assert.equal(isWhatsAppConversationSelectionCurrent({ ...selected, conversationId: 'conversation-b', generation: 6 }, empty, 'conversation-a'), false)
})
