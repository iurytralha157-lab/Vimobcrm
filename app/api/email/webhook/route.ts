import {
  hasResendWebhookSecret,
  verifyResendWebhook,
} from '@/integrations/email/webhooks'
import { emailWebhookEventSchema } from '@/lib/validation/email'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !hasResendWebhookSecret()) {
    return Response.json(
      {
        ok: false,
        message: 'RESEND_WEBHOOK_SECRET is required in production.',
      },
      { status: 503 }
    )
  }

  let payload: string

  try {
    payload = await request.text()
  } catch {
    return Response.json(
      {
        ok: false,
        message: 'Invalid request body.',
      },
      { status: 400 }
    )
  }

  let body: unknown
  let isVerified = false
  let svixId = request.headers.get('svix-id')

  try {
    const verifiedWebhook = verifyResendWebhook(payload, request.headers)

    body = verifiedWebhook.event
    isVerified = verifiedWebhook.verified
    svixId = verifiedWebhook.svixId ?? svixId
  } catch {
    return Response.json(
      {
        ok: false,
        message: 'Invalid Resend webhook signature or JSON body.',
      },
      { status: 400 }
    )
  }

  const parsed = emailWebhookEventSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        message: 'Invalid email webhook payload.',
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  // TODO: persist Resend webhook events in email_events.
  return Response.json({
    ok: true,
    event_type: parsed.data.type,
    verified: isVerified,
    svix_id: svixId ?? null,
  })
}
