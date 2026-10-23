import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiAdminNotificationDeliveryOperationsResponseSchema,
  notificationDeliveryOperationsQuerySchema,
  replayNotificationDeliveryInputSchema,
  apiWhatsAppNotificationResetPreviewResponseSchema,
  apiWhatsAppNotificationResetResponseSchema,
  whatsAppNotificationResetInputSchema,
  whatsAppNotificationResetScopeSchema,
} from './notifications'

const validDelivery = {
  id: '11111111-1111-4111-8111-111111111111',
  notificationId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  title: 'Novo lead recebido',
  channel: 'whatsapp',
  recipientKey: 'user:44444444-4444-4444-8444-444444444444',
  status: 'retry_wait',
  priority: 250,
  attemptCount: 2,
  maxAttempts: 24,
  expiresAt: '2026-09-08T12:00:00Z',
  createdAt: '2026-09-05T12:00:00Z',
  updatedAt: '2026-09-05T12:01:00Z',
}

test('accepts the admin notification delivery operations contract', () => {
  const result = apiAdminNotificationDeliveryOperationsResponseSchema.safeParse({
    data: {
      metrics: [{
        organizationId: validDelivery.organizationId,
        channel: 'whatsapp',
        status: 'retry_wait',
        deliveryCount: 3,
        dueCount: 1,
        oldestCreatedAt: validDelivery.createdAt,
        oldestNextAttemptAt: validDelivery.updatedAt,
        oldestLeaseExpiresAt: null,
        maxAttemptCount: 2,
      }],
      deliveries: [validDelivery],
    },
  })

  assert.equal(result.success, true)
})

test('rejects unknown delivery states and unsafe list bounds', () => {
  assert.equal(notificationDeliveryOperationsQuerySchema.safeParse({ status: 'unknown' }).success, false)
  assert.equal(notificationDeliveryOperationsQuerySchema.safeParse({ limit: 101 }).success, false)
  assert.equal(apiAdminNotificationDeliveryOperationsResponseSchema.safeParse({
    data: { metrics: [], deliveries: [{ ...validDelivery, status: 'pending' }] },
  }).success, false)
})

test('requires an auditable replay reason', () => {
  assert.equal(replayNotificationDeliveryInputSchema.safeParse({ reason: '  ' }).success, false)
  assert.equal(replayNotificationDeliveryInputSchema.safeParse({ reason: 'Incidente resolvido.' }).success, true)
  assert.equal(replayNotificationDeliveryInputSchema.safeParse({ reason: '🔔'.repeat(1_000) }).success, true)
  assert.equal(replayNotificationDeliveryInputSchema.safeParse({ reason: '🔔'.repeat(1_001) }).success, false)
})

const validReset = {
  scope: 'organization',
  organizationId: validDelivery.organizationId,
  cutoffAt: '2026-10-15T12:00:00.123456Z',
  reason: 'Cancelar avisos antigos antes de conectar o WhatsApp.',
  confirmation: 'RESETAR',
}

test('requires an explicit organization or an unambiguous global reset scope', () => {
  assert.equal(whatsAppNotificationResetScopeSchema.safeParse({
    scope: 'organization', organizationId: validDelivery.organizationId,
  }).success, true)
  assert.equal(whatsAppNotificationResetScopeSchema.safeParse({ scope: 'all' }).success, true)
  for (const input of [
    {},
    { scope: 'organization' },
    { scope: 'organization', organizationId: 'other-organization' },
    { scope: 'all', organizationId: validDelivery.organizationId },
    { scope: 'all', channel: 'email' },
    { scope: 'unknown' },
  ]) {
    assert.equal(whatsAppNotificationResetScopeSchema.safeParse(input).success, false)
  }
})

test('reset requires a dated preview, exact confirmation and bounded Unicode audit reason', () => {
  assert.equal(whatsAppNotificationResetInputSchema.safeParse(validReset).success, true)
  assert.equal(whatsAppNotificationResetInputSchema.safeParse({
    scope: 'all', cutoffAt: validReset.cutoffAt, reason: validReset.reason, confirmation: 'RESETAR',
  }).success, true)
  for (const patch of [
    { cutoffAt: 'yesterday' },
    { cutoffAt: '2026-10-15T12:00:00' },
    { confirmation: 'resetar' },
    { confirmation: '' },
    { reason: '  ' },
    { reason: '🔔'.repeat(1_001) },
    { channel: 'email' },
  ]) {
    assert.equal(whatsAppNotificationResetInputSchema.safeParse({ ...validReset, ...patch }).success, false)
  }
  const parsed = whatsAppNotificationResetInputSchema.parse({ ...validReset, reason: `  ${'🔔'.repeat(1_000)}  ` })
  assert.equal(parsed.reason, '🔔'.repeat(1_000))
})

test('reset responses preserve explicit scope and validate truthful operation counts', () => {
  const previewData = {
    scope: 'organization', organizationId: validReset.organizationId,
    cutoffAt: validReset.cutoffAt, pendingCount: 12, inFlightCount: 3,
  }
  assert.equal(apiWhatsAppNotificationResetPreviewResponseSchema.safeParse({ data: previewData }).success, true)
  assert.equal(apiWhatsAppNotificationResetPreviewResponseSchema.safeParse({
    data: { scope: 'all', cutoffAt: validReset.cutoffAt, pendingCount: 12, inFlightCount: 3 },
  }).success, true)
  assert.equal(apiWhatsAppNotificationResetPreviewResponseSchema.safeParse({ data: { ...previewData, cutoffAt: 'invalid' } }).success, false)
  assert.equal(apiWhatsAppNotificationResetPreviewResponseSchema.safeParse({ data: { ...previewData, pendingCount: -1 } }).success, false)
  assert.equal(apiWhatsAppNotificationResetPreviewResponseSchema.safeParse({ data: { ...previewData, inFlightCount: 0.5 } }).success, false)
  assert.equal(apiWhatsAppNotificationResetResponseSchema.safeParse({ data: { cancelledCount: 10, inFlightCount: 2 } }).success, true)
  assert.equal(apiWhatsAppNotificationResetResponseSchema.safeParse({ data: { cancelledCount: -1, inFlightCount: 2 } }).success, false)
})
