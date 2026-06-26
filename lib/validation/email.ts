import { EMAIL_TEMPLATE_KEYS } from '@/integrations/email/provider'
import { z } from 'zod'

export const emailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS)

export const emailRecipientSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120).optional(),
})

export const emailPayloadSchema = z.record(z.string(), z.unknown())

const optionalShortTextSchema = z.string().trim().min(1).max(180).optional()
const optionalUrlSchema = z.string().trim().url().optional()

export const organizationInviteEmailPayloadSchema = z.object({
  invitedEmail: z.string().trim().email(),
  organizationName: z.string().trim().min(1).max(180),
  inviterName: optionalShortTextSchema,
  inviteUrl: optionalUrlSchema,
})

export const welcomeEmailPayloadSchema = z.object({
  name: optionalShortTextSchema,
  organizationName: optionalShortTextSchema,
  planName: optionalShortTextSchema,
  trialEndsAt: optionalShortTextSchema,
  checkoutUrl: optionalUrlSchema,
  appUrl: optionalUrlSchema,
  termsVersion: optionalShortTextSchema,
  privacyVersion: optionalShortTextSchema,
  isTrial: z.boolean().optional(),
  trialDays: z.number().int().positive().max(365).optional(),
})

export const legalAcceptanceEmailPayloadSchema = z.object({
  name: optionalShortTextSchema,
  acceptedAt: optionalShortTextSchema,
  termsVersion: optionalShortTextSchema,
  privacyVersion: optionalShortTextSchema,
})

export const paymentConfirmedEmailPayloadSchema = z.object({
  name: optionalShortTextSchema,
  planName: optionalShortTextSchema,
  amount: optionalShortTextSchema,
  paidAt: optionalShortTextSchema,
  appUrl: optionalUrlSchema,
})

const emailBaseSendRequestSchema = z.object({
  to: z.union([z.string().trim().email(), emailRecipientSchema]),
  subject: z.string().trim().min(1).max(180),
  organization_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  from: z.string().trim().min(3).max(180).optional(),
  reply_to: z.string().trim().email().optional(),
  idempotency_key: z.string().trim().min(1).max(256).optional(),
})

export const organizationInviteEmailRequestSchema = emailBaseSendRequestSchema.extend({
  template: z.literal('organization_invite'),
  payload: organizationInviteEmailPayloadSchema,
})

export const welcomeEmailRequestSchema = emailBaseSendRequestSchema.extend({
  template: z.literal('welcome'),
  payload: welcomeEmailPayloadSchema.optional().default({}),
})

export const legalAcceptanceEmailRequestSchema = emailBaseSendRequestSchema.extend({
  template: z.literal('legal_acceptance'),
  payload: legalAcceptanceEmailPayloadSchema.optional().default({}),
})

export const paymentConfirmedEmailRequestSchema = emailBaseSendRequestSchema.extend({
  template: z.literal('payment_confirmed'),
  payload: paymentConfirmedEmailPayloadSchema.optional().default({}),
})

export const emailSendRequestSchema = z.discriminatedUnion('template', [
  organizationInviteEmailRequestSchema,
  welcomeEmailRequestSchema,
  legalAcceptanceEmailRequestSchema,
  paymentConfirmedEmailRequestSchema,
])

export const emailWebhookEventSchema = z
  .object({
    type: z.string().trim().min(1),
    created_at: z.string().trim().optional(),
    data: emailPayloadSchema.optional().default({}),
  })
  .passthrough()

export type EmailTemplateKey = z.infer<typeof emailTemplateKeySchema>
export type EmailRecipient = z.infer<typeof emailRecipientSchema>
export type EmailPayload = z.infer<typeof emailPayloadSchema>
export type OrganizationInviteEmailPayload = z.infer<typeof organizationInviteEmailPayloadSchema>
export type WelcomeEmailPayload = z.infer<typeof welcomeEmailPayloadSchema>
export type LegalAcceptanceEmailPayload = z.infer<typeof legalAcceptanceEmailPayloadSchema>
export type PaymentConfirmedEmailPayload = z.infer<typeof paymentConfirmedEmailPayloadSchema>
export type OrganizationInviteEmailRequest = z.input<typeof organizationInviteEmailRequestSchema>
export type WelcomeEmailRequest = z.input<typeof welcomeEmailRequestSchema>
export type LegalAcceptanceEmailRequest = z.input<typeof legalAcceptanceEmailRequestSchema>
export type PaymentConfirmedEmailRequest = z.input<typeof paymentConfirmedEmailRequestSchema>
export type EmailSendRequest = z.input<typeof emailSendRequestSchema>
export type ParsedEmailSendRequest = z.infer<typeof emailSendRequestSchema>
export type EmailWebhookEvent = z.infer<typeof emailWebhookEventSchema>
