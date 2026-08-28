import { createHash } from 'node:crypto'
import { RequestBodyTooLargeError, readRequestTextWithLimit } from '@/lib/security/limited-request-body'
import {
  enforceServerRateLimit,
  getForwardedForHeader,
  getRequestRateLimitIdentity,
  rateLimitHeaders,
  ServerRateLimitError,
} from '@/lib/security/server-rate-limit'
import {
  onboardingStepValidationRequestSchema,
  onboardingStepValidationResponseSchema,
  type ParsedOnboardingStepValidationResponse,
} from '@/lib/validation/onboarding'

export const runtime = 'nodejs'

const VALIDATION_BACKEND_TIMEOUT_MS = 10_000
const VALIDATION_MAX_BODY_BYTES = 4 * 1024

function jsonResponse(body: ParsedOnboardingStepValidationResponse, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || 'http://localhost:8081').replace(/\/+$/, '')
}

function sensitiveIdentity(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function POST(request: Request) {
  const forwardedFor = getForwardedForHeader(request)
  const rateLimitIdentity = getRequestRateLimitIdentity(request)

  try {
    enforceServerRateLimit(`onboarding-validate-step:ip:${rateLimitIdentity}`, [
      { limit: 12, windowMs: 60_000 },
      { limit: 60, windowMs: 60 * 60_000 },
    ])
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return jsonResponse(
        { ok: false, valid: false, code: 'signup_rate_limited', message: 'Muitas tentativas. Aguarde antes de validar novamente.' },
        429,
        rateLimitHeaders(error),
      )
    }
    throw error
  }

  let rawBody: unknown
  try {
    const rawText = await readRequestTextWithLimit(request, VALIDATION_MAX_BODY_BYTES)
    rawBody = JSON.parse(rawText)
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError
    return jsonResponse(
      {
        ok: false,
        valid: false,
        code: tooLarge ? 'signup_payload_too_large' : 'signup_invalid_payload',
        message: tooLarge ? 'Os dados enviados ultrapassam o limite permitido.' : 'Dados de validação inválidos.',
      },
      tooLarge ? 413 : 400,
    )
  }

  const parsed = onboardingStepValidationRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, valid: false, code: 'signup_invalid_input', message: 'Revise os dados informados antes de continuar.' },
      400,
    )
  }

  const valueIdentity = parsed.data.step === 'organization'
    ? parsed.data.documentNumber
    : parsed.data.email

  try {
    enforceServerRateLimit(
      `onboarding-validate-step:value:${parsed.data.step}:${sensitiveIdentity(valueIdentity)}`,
      [
        { limit: 5, windowMs: 60_000 },
        { limit: 20, windowMs: 60 * 60_000 },
      ],
    )
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return jsonResponse(
        { ok: false, valid: false, code: 'signup_rate_limited', message: 'Muitas tentativas para estes dados. Aguarde antes de validar novamente.' },
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
  if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor)

  try {
    const response = await fetch(`${getAPIBaseURL()}/v1/public/onboarding/validate-step`, {
      method: 'POST',
      headers,
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(VALIDATION_BACKEND_TIMEOUT_MS),
    })
    const payload = onboardingStepValidationResponseSchema.safeParse(
      await response.json().catch(() => null),
    )

    if (!payload.success) {
      return jsonResponse(
        { ok: false, valid: false, code: 'signup_invalid_response', message: 'Não foi possível validar os dados agora.' },
        502,
      )
    }

    return jsonResponse(payload.data, response.status)
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return jsonResponse(
      {
        ok: false,
        valid: false,
        code: timedOut ? 'signup_validation_timeout' : 'signup_validation_unavailable',
        message: 'Não foi possível validar os dados agora. Tente novamente.',
      },
      timedOut ? 504 : 503,
    )
  }
}
