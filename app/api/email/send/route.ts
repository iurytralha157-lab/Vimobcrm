import {
  createEmailAPIResponse,
  getEmailAPIStatus,
  sendEmail,
} from '@/lib/api/email'
import { emailSendRequestSchema } from '@/lib/validation/email'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

function isAuthorizedInternalRequest(request: Request) {
  const secret = process.env.EMAIL_INTERNAL_SECRET?.trim()
  const providedSecret = request.headers.get('x-email-internal-secret')?.trim()

  if (!secret || !providedSecret) return false

  const secretBuffer = Buffer.from(secret)
  const providedSecretBuffer = Buffer.from(providedSecret)

  return (
    secretBuffer.length === providedSecretBuffer.length &&
    timingSafeEqual(secretBuffer, providedSecretBuffer)
  )
}

export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request)) {
    return Response.json(
      {
        ok: false,
        message: 'Unauthorized email request.',
      },
      { status: 401 }
    )
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return Response.json(
      {
        ok: false,
        message: 'Invalid JSON body.',
      },
      { status: 400 }
    )
  }

  const parsed = emailSendRequestSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        message: 'Invalid email request payload.',
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const result = await sendEmail(parsed.data)

  return Response.json(
    createEmailAPIResponse(result),
    { status: getEmailAPIStatus(result) }
  )
}
