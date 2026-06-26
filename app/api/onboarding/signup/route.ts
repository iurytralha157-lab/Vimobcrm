import { onboardingSignupSchema } from '@/lib/validation/onboarding'
import {
  enforceServerRateLimit,
  getRequestIp,
  rateLimitHeaders,
  ServerRateLimitError,
} from '@/lib/security/server-rate-limit'

export const runtime = 'nodejs'

type SignupResult = {
  ok: boolean
  message: string
  redirectTo?: string
  checkoutToken?: string | null
  organizationId?: string
}

function jsonResponse(body: SignupResult, status: number, headers?: HeadersInit) {
  return Response.json(body, { status, headers })
}

function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || 'http://localhost:8081').replace(/\/+$/, '')
}

async function postPublicBackend<T>(path: string, body: unknown) {
  const response = await fetch(`${getAPIBaseURL()}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as T | null
  return { response, payload }
}

export async function POST(request: Request) {
  let rawBody: unknown
  const clientIp = getRequestIp(request)

  try {
    enforceServerRateLimit(`onboarding-signup:ip:${clientIp}`, [
      { limit: 3, windowMs: 60_000 },
      { limit: 10, windowMs: 60 * 60_000 },
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

  try {
    rawBody = await request.json()
  } catch {
    return jsonResponse({ ok: false, message: 'Payload invalido.' }, 400)
  }

  const parsed = onboardingSignupSchema.safeParse(rawBody)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        message: 'Dados de cadastro invalidos.',
        issues: parsed.error.flatten(),
      },
      { status: 400 },
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
        { ok: false, message: 'Muitas tentativas para este e-mail. Aguarde antes de tentar novamente.' },
        429,
        rateLimitHeaders(error),
      )
    }

    throw error
  }

  try {
    const { response, payload } = await postPublicBackend<SignupResult>('/v1/public/onboarding/signup', {
      ...input,
      ipAddress: clientIp,
      userAgent: request.headers.get('user-agent') || '',
    })

    return jsonResponse(
      payload || { ok: false, message: 'Resposta invalida do backend.' },
      response.status,
    )
  } catch {
    return jsonResponse(
      {
        ok: false,
        message: 'A API do Vimob nao esta acessivel para concluir o cadastro.',
      },
      503,
    )
  }
}
