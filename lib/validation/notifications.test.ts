import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiAdminNotificationDeliveryOperationsResponseSchema,
  notificationDeliveryOperationsQuerySchema,
  replayNotificationDeliveryInputSchema,
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
