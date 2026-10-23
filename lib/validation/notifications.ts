import { z } from 'zod'

import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const notificationDeliveryStatusSchema = z.enum([
  'queued',
  'leased',
  'sending',
  'accepted',
  'delivered',
  'retry_wait',
  'blocked_dependency',
  'dead_letter',
  'cancelled',
  'permanent_failed',
])

export const notificationDeliveryOperationsQuerySchema = z.object({
  status: z.union([notificationDeliveryStatusSchema, z.literal('all'), z.literal('problems')]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()

export const replayNotificationDeliveryInputSchema = z.object({
  reason: z.string().trim().min(1).refine(
    (value) => Array.from(value).length <= 1_000,
    { message: 'Replay reason must contain at most 1,000 characters' },
  ),
}).strict()

export const whatsAppNotificationResetScopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('organization'), organizationId: uuidSchema }).strict(),
  z.object({ scope: z.literal('all') }).strict(),
])

const notificationResetFields = {
  cutoffAt: z.string().datetime({ offset: true }),
  reason: replayNotificationDeliveryInputSchema.shape.reason,
  confirmation: z.literal('RESETAR'),
}

export const whatsAppNotificationResetInputSchema = z.discriminatedUnion('scope', [
  whatsAppNotificationResetScopeSchema.options[0].extend(notificationResetFields),
  whatsAppNotificationResetScopeSchema.options[1].extend(notificationResetFields),
])

const notificationResetPreviewFields = {
  cutoffAt: z.string().datetime({ offset: true }),
  pendingCount: nonNegativeIntegerSchema,
  inFlightCount: nonNegativeIntegerSchema,
}

export const whatsAppNotificationResetPreviewSchema = z.discriminatedUnion('scope', [
  whatsAppNotificationResetScopeSchema.options[0].extend(notificationResetPreviewFields),
  whatsAppNotificationResetScopeSchema.options[1].extend(notificationResetPreviewFields),
])

export const apiWhatsAppNotificationResetPreviewResponseSchema = apiEnvelopeSchema(
  whatsAppNotificationResetPreviewSchema,
)

export const apiWhatsAppNotificationResetResponseSchema = apiEnvelopeSchema(z.object({
  cancelledCount: nonNegativeIntegerSchema,
  inFlightCount: nonNegativeIntegerSchema,
}).strict())

export type WhatsAppNotificationResetScope = z.infer<typeof whatsAppNotificationResetScopeSchema>
export type WhatsAppNotificationResetInput = z.infer<typeof whatsAppNotificationResetInputSchema>
export type WhatsAppNotificationResetPreview = z.infer<typeof whatsAppNotificationResetPreviewSchema>

const nullableTimestampSchema = timestampSchema.nullable().optional()

export const apiNotificationDeliveryMetricSchema = z.object({
  organizationId: uuidSchema,
  channel: z.enum(['whatsapp', 'push', 'email']),
  status: notificationDeliveryStatusSchema,
  deliveryCount: nonNegativeIntegerSchema,
  dueCount: nonNegativeIntegerSchema,
  oldestCreatedAt: nullableTimestampSchema,
  oldestNextAttemptAt: nullableTimestampSchema,
  oldestLeaseExpiresAt: nullableTimestampSchema,
  maxAttemptCount: nonNegativeIntegerSchema,
}).passthrough()

export const apiNotificationDeliveryOperationSchema = z.object({
  id: uuidSchema,
  notificationId: uuidSchema,
  organizationId: uuidSchema,
  organizationName: z.string().nullable().optional(),
  userId: uuidSchema.nullable().optional(),
  eventKey: z.string().nullable().optional(),
  title: z.string(),
  channel: z.enum(['whatsapp', 'push', 'email']),
  recipientKey: z.string(),
  status: notificationDeliveryStatusSchema,
  priority: nonNegativeIntegerSchema,
  attemptCount: nonNegativeIntegerSchema,
  maxAttempts: nonNegativeIntegerSchema,
  nextAttemptAt: nullableTimestampSchema,
  expiresAt: timestampSchema,
  leaseExpiresAt: nullableTimestampSchema,
  dependencyKey: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  providerMessageId: z.string().nullable().optional(),
  providerStatus: z.string().nullable().optional(),
  acceptedAt: nullableTimestampSchema,
  deliveredAt: nullableTimestampSchema,
  terminalAt: nullableTimestampSchema,
  lastErrorCode: z.string().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  lastErrorAt: nullableTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()

export const apiAdminNotificationDeliveryOperationsResponseSchema = apiEnvelopeSchema(z.object({
  metrics: z.array(apiNotificationDeliveryMetricSchema),
  deliveries: z.array(apiNotificationDeliveryOperationSchema),
}))
