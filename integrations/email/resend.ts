import type { EmailProvider, SendEmailInput, SendEmailResult } from './provider'
import { renderEmailTemplate } from './templates/render'

const RESEND_API_KEY_ENV = 'RESEND_API_KEY'
const RESEND_FROM_EMAIL_ENV = 'RESEND_FROM_EMAIL'
const RESEND_REPLY_TO_ENV = 'RESEND_REPLY_TO'
const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails'

function getDefaultFromEmail() {
  return process.env[RESEND_FROM_EMAIL_ENV]?.trim() || 'Vimob CRM <naoresponde@vimobcrm.com.br>'
}

function getDefaultReplyTo() {
  return process.env[RESEND_REPLY_TO_ENV]?.trim() || undefined
}

function cleanHeaderValue(value: string) {
  return value.replace(/[\r\n]/g, ' ').trim()
}

function formatRecipient(to: SendEmailInput['to']) {
  if (typeof to === 'string') return cleanHeaderValue(to)

  return cleanHeaderValue(to.email)
}

type ResendSendResponse = {
  id?: string
  message?: string
  name?: string
  error?: string
}

export const resendEmailProvider: EmailProvider = {
  name: 'resend',

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env[RESEND_API_KEY_ENV]?.trim()

    if (!apiKey) {
      return {
        ok: false,
        provider: 'resend',
        mode: 'placeholder',
        status: 'skipped',
        message: 'RESEND_API_KEY is not configured; email was not sent.',
        error: 'RESEND_API_KEY is not configured.',
        metadata: {
          template: input.template,
          organization_id: input.organization_id ?? null,
          user_id: input.user_id ?? null,
          has_api_key: false,
        },
      }
    }

    const rendered = renderEmailTemplate(input.template, input.payload)
    const replyTo = input.reply_to || getDefaultReplyTo()
    const body = {
      from: cleanHeaderValue(input.from || getDefaultFromEmail()),
      to: [formatRecipient(input.to)],
      subject: cleanHeaderValue(input.subject),
      html: rendered.html,
      ...(replyTo ? { reply_to: cleanHeaderValue(replyTo) } : {}),
    }
    const idempotencyKey = input.idempotency_key?.trim()

    try {
      const response = await fetch(RESEND_EMAILS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': cleanHeaderValue(idempotencyKey) } : {}),
        },
        body: JSON.stringify(body),
      })
      const data = (await response.json().catch(() => ({}))) as ResendSendResponse

      if (!response.ok || !data.id) {
        const message = data.message || data.error || 'Resend rejected the email request.'

        return {
          ok: false,
          provider: 'resend',
          mode: 'live',
          status: 'failed',
          message,
          error: message,
          metadata: {
            template: input.template,
            organization_id: input.organization_id ?? null,
            user_id: input.user_id ?? null,
            idempotency_key: input.idempotency_key ?? null,
            resend_error_name: data.name ?? null,
          },
        }
      }

      return {
        ok: true,
        provider: 'resend',
        mode: 'live',
        status: 'sent',
        message: 'Email sent by Resend.',
        messageId: data.id,
        metadata: {
          template: input.template,
          organization_id: input.organization_id ?? null,
          user_id: input.user_id ?? null,
          idempotency_key: input.idempotency_key ?? null,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Resend request failed.'

      return {
        ok: false,
        provider: 'resend',
        mode: 'live',
        status: 'failed',
        message,
        error: message,
        metadata: {
          template: input.template,
          organization_id: input.organization_id ?? null,
          user_id: input.user_id ?? null,
          idempotency_key: input.idempotency_key ?? null,
        },
      }
    }
  },
}

export async function sendEmail(input: SendEmailInput) {
  return resendEmailProvider.sendEmail(input)
}
