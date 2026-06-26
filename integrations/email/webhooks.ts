import { Resend, type WebhookEventPayload } from 'resend'

const RESEND_WEBHOOK_SECRET_ENV = 'RESEND_WEBHOOK_SECRET'

export type VerifiedResendWebhook = {
  event: WebhookEventPayload
  verified: boolean
  svixId?: string
}

export function hasResendWebhookSecret() {
  return Boolean(process.env[RESEND_WEBHOOK_SECRET_ENV]?.trim())
}

export function verifyResendWebhook(payload: string, headers: Headers): VerifiedResendWebhook {
  const webhookSecret = process.env[RESEND_WEBHOOK_SECRET_ENV]?.trim()

  if (!webhookSecret) {
    return {
      event: JSON.parse(payload) as WebhookEventPayload,
      verified: false,
    }
  }

  const id = headers.get('svix-id')
  const timestamp = headers.get('svix-timestamp')
  const signature = headers.get('svix-signature')

  if (!id || !timestamp || !signature) {
    throw new Error('Missing Resend webhook signature headers.')
  }

  const resend = new Resend()
  const event = resend.webhooks.verify({
    payload,
    headers: {
      id,
      timestamp,
      signature,
    },
    webhookSecret,
  })

  return {
    event,
    verified: true,
    svixId: id,
  }
}
