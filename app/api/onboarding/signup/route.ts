import {
  onboardingSignupResponseSchema,
  onboardingSignupSchema,
  type ParsedOnboardingSignupResponse,
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

const SIGNUP_BACKEND_TIMEOUT_MS = 45_000
const SIGNUP_MAX_BODY_BYTES = 16 * 1024

type SignupResult = ParsedOnboardingSignupResponse
type SignupResponseBody = SignupResult | {
  ok: false
  code: string
  message: string
  issues?: unknown
}

function jsonResponse(body: SignupResponseBody, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || 'http://localhost:8081').replace(/\/+$/, '')
}

async function postPublicBackend(path: string, body: unknown, forwardedFor: string | null) {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })
  if (forwardedFor) {
    headers.set('X-Forwarded-For', forwardedFor)
  }

  const response = await fetch(`${getAPIBaseURL()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(SIGNUP_BACKEND_TIMEOUT_MS),
  })
  const rawPayload = await response.json().catch(() => null)
  const payload = onboardingSignupResponseSchema.safeParse(rawPayload)
  return { response, payload }
}

export async function POST(request: Request) {
  let rawBody: unknown
  const clientIp = getRequestIp(request)
  const forwardedFor = getForwardedForHeader(request)
  const rateLimitIdentity = getRequestRateLimitIdentity(request)

  try {
    enforceServerRateLimit(`onboarding-signup:ip:${rateLimitIdentity}`, [
      { limit: 3, windowMs: 60_000 },
      { limit: 10, windowMs: 60 * 60_000 },
    ])
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return jsonResponse(
        { ok: false, code: 'signup_rate_limited', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
        429,
        rateLimitHeaders(error),
      )
    }

    throw error
  }

  try {
    const rawText = await readRequestTextWithLimit(request, SIGNUP_MAX_BODY_BYTES)
    rawBody = JSON.parse(rawText)
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError
    return jsonResponse(
      {
        ok: false,
        code: tooLarge ? 'signup_payload_too_large' : 'signup_invalid_payload',
        message: tooLarge ? 'Os dados enviados ultrapassam o limite permitido.' : 'Payload invalido.',
      },
      tooLarge ? 413 : 400,
    )
  }

  const parsed = onboardingSignupSchema.safeParse(rawBody)
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: 'signup_invalid_input',
        message: 'Dados de cadastro invalidos.',
        issues: parsed.error.flatten(),
      },
      400,
    )
  }

  const input = parsed.data
  try {
    enforceServerRateLimit(`onboarding-signup:email:${input.email}`, [
      { limit: 2, windowMs: 60_000 },
      { limit: 5, windowMs: 60 * 60_000 },
    ])
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return jsonResponse(
        { ok: false, code: 'signup_rate_limited', message: 'Muitas tentativas para este e-mail. Aguarde antes de tentar novamente.' },
        429,
        rateLimitHeaders(error),
      )
    }

    throw error
  }

  try {
    const { response, payload } = await postPublicBackend(
      '/v1/public/onboarding/signup',
      {
        ...input,
        ipAddress: clientIp,
        userAgent: request.headers.get('user-agent') || '',
      },
      forwardedFor,
    )

    if (!payload.success) {
      return jsonResponse(
        { ok: false, code: 'signup_invalid_response', message: 'O servidor devolveu uma resposta de cadastro invalida. Tente novamente.' },
        502,
      )
    }

    return jsonResponse(payload.data, response.status)
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return jsonResponse(
      {
        ok: false,
        code: timedOut ? 'signup_timeout' : 'signup_unavailable',
        message: timedOut
          ? 'O cadastro demorou mais que o esperado. Tente novamente: a mesma tentativa sera retomada com seguranca.'
          : 'Nao foi possivel concluir o cadastro agora. Tente novamente.',
      },
      timedOut ? 504 : 503,
    )
  }
}
