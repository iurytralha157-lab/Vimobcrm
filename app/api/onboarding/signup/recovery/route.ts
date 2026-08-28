import {
  onboardingSignupRecoveryResponseSchema,
  onboardingSignupRecoverySchema,
  type ParsedOnboardingSignupRecoveryResponse,
} from '@/lib/validation/onboarding'
import { RequestBodyTooLargeError, readRequestTextWithLimit } from '@/lib/security/limited-request-body'
import {
  enforceServerRateLimit,
  getForwardedForHeader,
  getRequestIp,
  getRequestRateLimitIdentity,
  rateLimitHeaders,
  ServerRateLimitError,
} from '@/lib/security/server-rate-limit'

export const runtime = 'nodejs'

const RECOVERY_BACKEND_TIMEOUT_MS = 30_000
const RECOVERY_MAX_BODY_BYTES = 8 * 1024

function jsonResponse(body: ParsedOnboardingSignupRecoveryResponse, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || 'http://localhost:8081').replace(/\/+$/, '')
}

export async function POST(request: Request) {
  const identity = getRequestRateLimitIdentity(request)
  try {
    enforceServerRateLimit(`onboarding-signup-recovery:${identity}`, [
      { limit: 4, windowMs: 60_000 },
      { limit: 12, windowMs: 60 * 60_000 },
    ])
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return jsonResponse(
        { ok: false, message: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
        429,
        rateLimitHeaders(error),
      )
    }
    throw error
  }

  let rawBody: unknown
  try {
    const rawText = await readRequestTextWithLimit(request, RECOVERY_MAX_BODY_BYTES)
    rawBody = JSON.parse(rawText)
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        code: error instanceof RequestBodyTooLargeError
          ? 'signup_payload_too_large'
          : 'signup_invalid_payload',
        message: error instanceof RequestBodyTooLargeError
          ? 'Os dados enviados ultrapassam o limite permitido.'
          : 'Revise os dados informados.',
      },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    )
  }
  const parsed = onboardingSignupRecoverySchema.safeParse(rawBody)
  if (!parsed.success) {
    return jsonResponse({ ok: false, message: 'Revise os dados informados.' }, 400)
  }

  const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' })
  const forwardedFor = getForwardedForHeader(request)
  if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor)

  try {
    const response = await fetch(`${getAPIBaseURL()}/v1/public/onboarding/signup/recovery`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...parsed.data,
        ipAddress: getRequestIp(request),
        userAgent: request.headers.get('user-agent') || '',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(RECOVERY_BACKEND_TIMEOUT_MS),
    })
    const payload = onboardingSignupRecoveryResponseSchema.safeParse(await response.json().catch(() => null))
    if (!payload.success) {
      return jsonResponse({ ok: false, message: 'O servidor devolveu uma resposta inválida. Tente novamente.' }, 502)
    }
    return jsonResponse(payload.data, response.status)
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return jsonResponse(
      {
        ok: false,
        message: timedOut
          ? 'A alteração demorou mais que o esperado. Aguarde e tente novamente com os mesmos dados.'
          : 'Não foi possível alterar o cadastro agora. Tente novamente.',
      },
      timedOut ? 504 : 503,
    )
  }
}
