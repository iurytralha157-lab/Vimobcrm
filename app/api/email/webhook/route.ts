import {
  hasResendWebhookSecret,
  verifyResendWebhook,
} from '@/integrations/email/webhooks'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildRecordResendEmailEventArgs,
  persistResendEmailEvent,
} from '@/lib/email/resend-webhook-event'
import { emailWebhookEventSchema } from '@/lib/validation/email'
import {
  readRequestTextWithLimit,
  RequestBodyTooLargeError,
} from '@/lib/security/limited-request-body'

export const runtime = 'nodejs'

const RESEND_WEBHOOK_MAX_BODY_BYTES = 256 * 1024

export async function POST(request: Request) {
  if (!hasResendWebhookSecret()) {
    return Response.json(
      {
        ok: false,
        message: 'Webhook verification is unavailable.',
      },
      { status: 503 }
    )
  }

  let payload: string

  try {
    payload = await readRequestTextWithLimit(request, RESEND_WEBHOOK_MAX_BODY_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        {
          ok: false,
          message: 'Webhook payload is too large.',
        },
        { status: 413 },
      )
    }
    return Response.json(
      {
        ok: false,
        message: 'Invalid request body.',
      },
      { status: 400 }
    )
  }

  let body: unknown
  let svixId = request.headers.get('svix-id')

  try {
    const verifiedWebhook = verifyResendWebhook(payload, request.headers)

    body = verifiedWebhook.event
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

  if (!svixId) {
    return Response.json(
      {
        ok: false,
        message: 'Missing Resend webhook event identifier.',
      },
      { status: 400 },
    )
  }

  let rpcArgs: ReturnType<typeof buildRecordResendEmailEventArgs>
  try {
    rpcArgs = buildRecordResendEmailEventArgs(parsed.data, svixId)
  } catch {
    return Response.json(
      {
        ok: false,
        message: 'Invalid Resend email event.',
      },
      { status: 400 },
    )
  }

  const persistence = await persistResendEmailEvent(rpcArgs, (args) =>
    createAdminClient().rpc('record_resend_email_event', args),
  )

  if (!persistence.ok) {
    console.error('[email/webhook] Could not persist verified Resend event.', {
      error: persistence.error,
      eventType: parsed.data.type,
      providerMessageId: parsed.data.data.email_id,
    })

    return Response.json(
      {
        ok: false,
        message: 'Could not persist Resend webhook event.',
      },
      { status: 500 },
    )
  }

  return Response.json({
    ok: true,
    event_type: parsed.data.type,
    verified: true,
    duplicate: persistence.duplicate,
    svix_id: svixId,
  })
}
