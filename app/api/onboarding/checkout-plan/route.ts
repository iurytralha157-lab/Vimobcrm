import { z } from 'zod'
import {
  enforceServerRateLimit,
  getRequestIp,
  rateLimitHeaders,
  ServerRateLimitError,
} from '@/lib/security/server-rate-limit'

export const runtime = 'nodejs'

const checkoutPlanSchema = z.object({
  checkoutToken: z.string().trim().regex(/^[a-f0-9]{48}$/i),
  planSlug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/i),
})

function jsonResponse(
  body: {
    ok: boolean
    message: string
    requiresPayment?: boolean
    checkoutToken?: string | null
    organizationId?: string
  },
  status: number,
  headers?: HeadersInit,
) {
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
    enforceServerRateLimit(`checkout-plan:ip:${clientIp}`, [
      { limit: 8, windowMs: 60_000 },
      { limit: 40, windowMs: 60 * 60_000 },
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

  const parsed = checkoutPlanSchema.safeParse(rawBody)
  if (!parsed.success) {
    return jsonResponse({ ok: false, message: 'Dados de plano invalidos.' }, 400)
  }

  const { checkoutToken } = parsed.data
  try {
    enforceServerRateLimit(`checkout-plan:token:${checkoutToken}`, [
      { limit: 5, windowMs: 60_000 },
      { limit: 20, windowMs: 60 * 60_000 },
    ])
  } catch (error) {
    if (error instanceof ServerRateLimitError) {
      return jsonResponse(
        { ok: false, message: 'Muitas tentativas para este checkout. Aguarde antes de tentar novamente.' },
        429,
        rateLimitHeaders(error),
      )
    }

    throw error
  }

  try {
    const { response, payload } = await postPublicBackend<{
      ok: boolean
      message: string
      requiresPayment?: boolean
      checkoutToken?: string | null
      organizationId?: string
    }>('/v1/public/onboarding/checkout-plan', parsed.data)

    return jsonResponse(
      payload || { ok: false, message: 'Resposta invalida do backend.' },
      response.status,
    )
  } catch {
    return jsonResponse(
      {
        ok: false,
        message: 'A API do Vimob nao esta acessivel para atualizar o plano.',
      },
      503,
    )
  }
}
