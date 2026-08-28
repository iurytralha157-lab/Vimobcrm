import {
  onboardingEmailConfirmationResendResponseSchema,
  onboardingEmailConfirmationResendSchema,
} from '@/lib/validation/onboarding'
import { RequestBodyTooLargeError, readRequestTextWithLimit } from '@/lib/security/limited-request-body'
import {
  enforceServerRateLimit,
  getForwardedForHeader,
  getRequestRateLimitIdentity,
  rateLimitHeaders,
  ServerRateLimitError,
} from '@/lib/security/server-rate-limit'

export const runtime = 'nodejs'

const RESEND_BACKEND_TIMEOUT_MS = 15_000
const RESEND_MAX_BODY_BYTES = 2 * 1024

function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || 'http://localhost:8081').replace(/\/+$/, '')
}

function publicResponse(ok: boolean, message: string, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  return Response.json({ ok, message }, { status, headers: responseHeaders })
}

export async function POST(request: Request) {
  const clientIdentity = getRequestRateLimitIdentity(request)

  try {
    enforceServerRateLimit(`onboarding-confirmation-resend:ip:${clientIdentity}`, [
      { limit: 2, windowMs: 60_000 },
      { limit: 5, windowMs: 60 * 60_000 },
    ])
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return publicResponse(
        false,
        'Muitas tentativas. Aguarde antes de solicitar outro e-mail.',
        429,
        rateLimitHeaders(error),
      )
    }
    throw error
  }

  let rawBody: unknown
  try {
    const rawText = await readRequestTextWithLimit(request, RESEND_MAX_BODY_BYTES)
    rawBody = JSON.parse(rawText)
  } catch (error) {
    return publicResponse(
      false,
      error instanceof RequestBodyTooLargeError
        ? 'Os dados enviados ultrapassam o limite permitido.'
        : 'Informe um e-mail valido.',
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    )
  }

  const parsed = onboardingEmailConfirmationResendSchema.safeParse(rawBody)
  if (!parsed.success) {
    return publicResponse(false, 'Informe um e-mail valido.', 400)
  }

  try {
    enforceServerRateLimit(`onboarding-confirmation-resend:email:${parsed.data.email}`, [
      { limit: 1, windowMs: 60_000 },
      { limit: 3, windowMs: 60 * 60_000 },
    ])
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return publicResponse(
        false,
        'Muitas tentativas. Aguarde antes de solicitar outro e-mail.',
        429,
        rateLimitHeaders(error),
      )
    }
    throw error
  }

  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })
  const forwardedFor = getForwardedForHeader(request)
  if (forwardedFor) {
    headers.set('X-Forwarded-For', forwardedFor)
  }

  try {
    const response = await fetch(
      `${getAPIBaseURL()}/v1/public/onboarding/email-confirmation/resend`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(parsed.data),
        cache: 'no-store',
        signal: AbortSignal.timeout(RESEND_BACKEND_TIMEOUT_MS),
      },
    )
    const payload = onboardingEmailConfirmationResendResponseSchema.safeParse(
      await response.json().catch(() => null),
    )
    if (!payload.success) {
      return publicResponse(false, 'Nao foi possivel solicitar outro e-mail agora.', 502)
    }
    return publicResponse(payload.data.ok, payload.data.message, response.status)
  } catch (error) {
    const timedOut = error instanceof DOMException
      && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return publicResponse(
      false,
      timedOut
        ? 'A solicitacao demorou mais que o esperado. Tente novamente em instantes.'
        : 'Nao foi possivel solicitar outro e-mail agora.',
      timedOut ? 504 : 503,
    )
  }
}
