import assert from 'node:assert/strict'
import test from 'node:test'
import { VimobAPIError } from './api/vimob-error'
import { decodeWhatsAppPhoneChangeConfirmation, getWhatsAppPhoneChangeConfirmation } from './whatsapp-phone-change'
import { startWhatsAppConversationInputSchema } from './validation/whatsapp'
const refs = { conversationId: '11111111-1111-4111-8111-111111111111', leadId: '22222222-2222-4222-8222-222222222222', sessionId: '33333333-3333-4333-8333-333333333333' }
const code = 'whatsapp_phone_change_confirmation_required'
test('phone correction handshake retains only reviewed authorized references', () => {
  assert.deepEqual(decodeWhatsAppPhoneChangeConfirmation(code, refs), refs)
  assert.equal(decodeWhatsAppPhoneChangeConfirmation('different_conflict', refs), undefined)
  assert.equal(decodeWhatsAppPhoneChangeConfirmation(code, { ...refs, raw: 'private' }), undefined)
  assert.equal(decodeWhatsAppPhoneChangeConfirmation(code, { ...refs, conversationId: 'bad' }), undefined)
  assert.deepEqual(getWhatsAppPhoneChangeConfirmation(new VimobAPIError('Confirm', { status: 409, code, responseData: refs })), refs)
  assert.equal(getWhatsAppPhoneChangeConfirmation(new VimobAPIError('Generic', { status: 409, code })), null)
})
test('phone correction requires confirmation and exact previous lead/session/conversation snapshot', () => {
  const input = { phone: '+5511999999999', sessionId: refs.sessionId, leadId: refs.leadId, expectedPreviousLeadId: refs.leadId, confirmPhoneChange: true, expectedPreviousConversationId: refs.conversationId }
  assert.equal(startWhatsAppConversationInputSchema.safeParse(input).success, true)
  for (const invalid of [{ ...input, expectedPreviousLeadId: 'unlinked' }, { ...input, expectedPreviousConversationId: undefined }, { ...input, sessionId: undefined }, { ...input, leadId: undefined }, { ...input, confirmPhoneChange: false }]) {
    assert.equal(startWhatsAppConversationInputSchema.safeParse(invalid).success, false)
  }
})
test('combined phone change requires both consent and exact destination history reference', () => {
  const destinationConversationId = '44444444-4444-4444-8444-444444444444'
  const response = { ...refs, destinationConversationId, requiresDestinationHistoryConfirmation: true }
  assert.deepEqual(decodeWhatsAppPhoneChangeConfirmation(code, response), response)
  assert.equal(decodeWhatsAppPhoneChangeConfirmation(code, { ...refs, destinationConversationId }), undefined)
  assert.equal(decodeWhatsAppPhoneChangeConfirmation(code, { ...refs, requiresDestinationHistoryConfirmation: true }), undefined)
  const input = { phone: '+5511999999999', sessionId: refs.sessionId, leadId: refs.leadId, expectedPreviousLeadId: refs.leadId, confirmPhoneChange: true, expectedPreviousConversationId: refs.conversationId, confirmDestinationHistory: true, expectedDestinationConversationId: destinationConversationId }
  assert.equal(startWhatsAppConversationInputSchema.safeParse(input).success, true)
  for (const invalid of [{ ...input, confirmDestinationHistory: false }, { ...input, expectedDestinationConversationId: undefined }, { ...input, confirmPhoneChange: false }]) {
    assert.equal(startWhatsAppConversationInputSchema.safeParse(invalid).success, false)
  }
})
