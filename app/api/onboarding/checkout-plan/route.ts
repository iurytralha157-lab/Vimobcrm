import { z } from 'zod'
import { RequestBodyTooLargeError, readRequestTextWithLimit } from '@/lib/security/limited-request-body'
import {
  enforceServerRateLimit,
  getRequestIp,
  rateLimitHeaders,
  ServerRateLimitError,
} from '@/lib/security/server-rate-limit'

export const runtime = 'nodejs'

const CHECKOUT_PLAN_BACKEND_TIMEOUT_MS = 15_000
const CHECKOUT_PLAN_MAX_BODY_BYTES = 2 * 1024

const checkoutPlanSchema = z.object({
  checkoutToken: z.string().trim().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{48})$/i),
  planSlug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/i),
})

const checkoutPlanResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().trim().min(1).max(500),
  requiresPayment: z.boolean().optional(),
  checkoutToken: z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{48})$/i).nullable().optional(),
  organizationId: z.string().uuid().optional(),
  plan: z.record(z.string(), z.unknown()).optional(),
})

function jsonResponse(
  body: {
    ok: boolean
    message: string
    requiresPayment?: boolean
    checkoutToken?: string | null
    organizationId?: string
    plan?: Record<string, unknown>
  },
  status: number,
  headers?: HeadersInit,
) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || 'http://localhost:8081').replace(/\/+$/, '')
}

async function postPublicBackend(path: string, body: unknown) {
  const response = await fetch(`${getAPIBaseURL()}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(CHECKOUT_PLAN_BACKEND_TIMEOUT_MS),
  })
  const payload = checkoutPlanResponseSchema.safeParse(
    await response.json().catch(() => null),
  )
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
    const rawText = await readRequestTextWithLimit(request, CHECKOUT_PLAN_MAX_BODY_BYTES)
    rawBody = JSON.parse(rawText)
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError
    return jsonResponse(
      {
        ok: false,
        message: tooLarge ? 'Os dados enviados ultrapassam o limite permitido.' : 'Payload invalido.',
      },
      tooLarge ? 413 : 400,
    )
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
    const { response, payload } = await postPublicBackend(
      '/v1/public/onboarding/checkout-plan',
      parsed.data,
    )

    if (!payload.success) {
      return jsonResponse(
        { ok: false, message: 'O servidor devolveu uma resposta inválida. Tente novamente.' },
        502,
      )
    }

    return jsonResponse(payload.data, response.status)
  } catch (error) {
    const timedOut = error instanceof DOMException
      && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return jsonResponse(
      {
        ok: false,
        message: timedOut
          ? 'A atualização do plano demorou mais que o esperado. Tente novamente.'
          : 'Não foi possível atualizar o plano agora. Tente novamente.',
      },
      timedOut ? 504 : 503,
    )
  }
}
