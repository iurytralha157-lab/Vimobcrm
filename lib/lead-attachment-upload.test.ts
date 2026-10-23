import assert from 'node:assert/strict'
import test from 'node:test'
import { getLeadAttachmentUploadReceipt } from '@/lib/lead-attachment-upload'

const scope = { organizationId: 'org-a', leadId: 'lead-a', userId: 'user-a', sessionId: 'session-a' }

test('the same selected File keeps its upload key through failed and successful retries', () => {
  const file = new File(['synthetic'], 'fixture.pdf')
  const first = getLeadAttachmentUploadReceipt(file, scope)
  assert.match(first.uploadRequestKey, /^[a-f\d-]{36}$/)
  assert.equal(getLeadAttachmentUploadReceipt(file, { ...scope }), first)
  assert.notEqual(getLeadAttachmentUploadReceipt(new File(['synthetic'], 'fixture.pdf'), scope).uploadRequestKey, first.uploadRequestKey)
  assert.notEqual(getLeadAttachmentUploadReceipt(file, { ...scope, leadId: 'lead-b' }).uploadRequestKey, first.uploadRequestKey)
  assert.notEqual(getLeadAttachmentUploadReceipt(file, { ...scope, organizationId: 'org-b' }).uploadRequestKey, first.uploadRequestKey)
})

test('a pending File cannot migrate to a replacement actor or session in the same destination', () => {
  const file = new File(['synthetic'], 'fixture.pdf')
  getLeadAttachmentUploadReceipt(file, scope)
  for (const changed of [{ ...scope, userId: 'user-b' }, { ...scope, sessionId: 'session-b' }]) {
    assert.throws(() => getLeadAttachmentUploadReceipt(file, changed), error => typeof error === 'object' && error !== null && 'code' in error && error.code === 'request_identity_changed')
  }
  assert.equal(getLeadAttachmentUploadReceipt(file, scope).userId, 'user-a')
})
