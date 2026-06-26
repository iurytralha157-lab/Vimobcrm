export const EMAIL_TEMPLATE_KEYS = [
  'organization_invite',
  'welcome',
  'legal_acceptance',
  'payment_confirmed',
] as const

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number]

export type EmailRecipient = {
  email: string
  name?: string
}

export type EmailPayload = Record<string, unknown>

export type EmailProviderName = 'resend'
export type EmailProviderMode = 'placeholder' | 'live'
export type SendEmailStatus = 'skipped' | 'queued' | 'sent' | 'failed'

export type SendEmailInput = {
  to: string | EmailRecipient
  subject: string
  template: EmailTemplateKey
  payload?: EmailPayload
  organization_id?: string
  user_id?: string
  from?: string
  reply_to?: string
  idempotency_key?: string
}

export type SendEmailResult = {
  ok: boolean
  provider: EmailProviderName
  mode: EmailProviderMode
  status: SendEmailStatus
  message: string
  messageId?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface EmailProvider {
  name: EmailProviderName
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>
}
