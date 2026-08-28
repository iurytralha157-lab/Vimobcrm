export const DEFAULT_PUBLIC_ERROR_MESSAGE =
  'Não foi possível concluir esta ação agora. Tente novamente em instantes.'

type ErrorDetails = {
  code?: unknown
  message?: unknown
  status?: unknown
  technicalMessage?: unknown
}

const TECHNICAL_ERROR_CODES = new Set([
  'api_timeout',
  'api_unavailable',
  'bad_gateway',
  'gateway_timeout',
  'internal_error',
  'internal_server_error',
  'service_unavailable',
  'upstream_error',
])

function getErrorDetails(error: unknown): ErrorDetails {
  if (!error || typeof error !== 'object') return {}
  return error as ErrorDetails
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeForComparison(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function getTechnicalErrorMessage(error: unknown, fallback = '') {
  if (typeof error === 'string') return error.trim() || fallback

  const details = getErrorDetails(error)
  return getString(details.technicalMessage) || getString(details.message) || fallback
}

export function isTechnicalServiceError(error: unknown) {
  const details = getErrorDetails(error)
  const code = getString(details.code).toLowerCase()
  const status = typeof details.status === 'number' ? details.status : null
  const message = normalizeForComparison(getTechnicalErrorMessage(error))

  if (TECHNICAL_ERROR_CODES.has(code)) return true
  if (status === 0 || (status !== null && status >= 500)) return true
  if (!message) return false

  return [
    /\b(?:a |da |com a )?(?:vimob )?api\b.*\b(?:demor\w*|parou|indisponivel|inacessivel|nao (?:esta )?acessivel|nao respondeu|sem resposta|fora do ar)\b/,
    /\berro ao (?:falar|conectar).*api\b/,
    /\b(?:failed to fetch|fetch failed|network error|networkerror|load failed)\b/,
    /\b(?:service unavailable|bad gateway|gateway timeout|connection refused|econnrefused|err_connection_refused)\b/,
    /\b(?:request|connection|operation).*(?:timed out|timeout)\b/,
    /\b(?:upstream connect error|connection reset|socket hang up)\b/,
    /\b(?:apps\/api|next_public_vimob_api_url)\b/,
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/,
  ].some((pattern) => pattern.test(message))
}

export function getPublicErrorMessage(
  error: unknown,
  fallback = DEFAULT_PUBLIC_ERROR_MESSAGE,
) {
  if (isTechnicalServiceError(error)) return fallback
  return getTechnicalErrorMessage(error, fallback)
}

export class VimobAPIError extends Error {
  code: string
  status: number
  requestId?: string
  technicalMessage: string

  constructor(
    technicalMessage: string,
    options: { code: string; status: number; requestId?: string },
  ) {
    super(getPublicErrorMessage({
      code: options.code,
      message: technicalMessage,
      status: options.status,
    }))
    this.name = 'VimobAPIError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.technicalMessage = technicalMessage
  }
}
